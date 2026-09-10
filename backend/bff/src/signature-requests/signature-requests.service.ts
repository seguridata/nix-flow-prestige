import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { SignatureMethod, SignerRole, SigningOrder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { EvidenceService } from '../evidence/evidence.service';
import { WorkflowService } from '../workflow/workflow.service';
import { SigningRouter } from '../signing/signing.router';
import { PdfStampService } from '../signing/pdf-stamp.service';
import { StorageService } from '../storage/storage.service';
import type { EncMeta } from '../storage/object-crypto';
import { CONSENT_TEXT, CONSENT_VERSION } from '../consent/consent';
import { CONTRATO_DOS_PARTES } from '../temporal/shared';
import { CollaborationService } from '../collaboration/collaboration.service';
import { SignerMailService } from '../notifications/signer-mail.service';
import { SignaturePolicyService } from '../signing/signature-policy';

export type { SignatureMethod, SigningOrder, SignerRole };

const INCLUDE_SIGNERS = { signers: { orderBy: { sortOrder: 'asc' as const } } };

@Injectable()
export class SignatureRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly evidence: EvidenceService,
    private readonly workflow: WorkflowService,
    private readonly signing: SigningRouter,
    private readonly stamp: PdfStampService,
    private readonly storage: StorageService,
    private readonly collab: CollaborationService,
    private readonly mail: SignerMailService,
    private readonly policyService: SignaturePolicyService,
  ) {}

  consentText() {
    return { version: CONSENT_VERSION, text: CONSENT_TEXT };
  }

  capabilities() {
    return this.signing.capabilities();
  }

  signaturePolicy(tenantId: string) {
    return this.policyService.resolve(tenantId);
  }

  async create(body: {
    documentId: string;
    methods: SignatureMethod[];
    order?: SigningOrder;
    requestedBy?: string;
    requestedByName?: string;
    tenantId: string;
    slaHours?: number;
    signers: { signerId: string; name?: string; email?: string; role?: SignerRole }[];
  }) {
    if (!body.methods?.length) {
      throw new BadRequestException('Debes autorizar al menos un método de firma');
    }
    // A-07 — el documento debe ser del tenant del solicitante.
    const doc = await this.prisma.document.findFirst({
      where: { id: body.documentId, tenantId: body.tenantId },
      select: { id: true, tenantId: true, caseId: true },
    });
    if (!doc) throw new NotFoundException(`Documento ${body.documentId} no encontrado`);

    // M10 — política de firma del tenant: valida los métodos y aplica defaults.
    const policy = await this.policyService.resolve(body.tenantId);
    const enforced = this.policyService.enforce(policy, {
      methods: body.methods as unknown as ('DIGITAL' | 'AUTOGRAFA' | 'BIOMETRICA')[],
      order: body.order,
      slaHours: body.slaHours,
    });
    const slaHours = enforced.slaHours;
    const expiresAt = new Date(Date.now() + slaHours * 3600_000);
    const created = await this.prisma.signatureRequest.create({
      data: {
        documentId: body.documentId,
        tenantId: doc.tenantId,
        methods: body.methods,
        order: enforced.order,
        requestedBy: body.requestedBy,
        requestedByName: body.requestedByName,
        slaHours,
        expiresAt,
        policyVersion: policy.version,
        policySnapshot: policy as unknown as object,
        signers: {
          create: body.signers.map((s, index) => ({
            signerId: s.signerId,
            name: s.name,
            email: s.email,
            role: s.role ?? 'FIRMANTE',
            sortOrder: index,
          })),
        },
      },
      include: INCLUDE_SIGNERS,
    });

    // M07 — «fuera de oficina»: fija la delegación en `Signer` ANTES de arrancar
    // el flujo, para que las tareas humanas se siembren ya a nombre del suplente.
    await this.applyOutOfOffice(
      created.id,
      created.documentId,
      created.signers.map((s) => ({ signerId: s.signerId, name: s.name })),
    );

    await this.workflow.startInstance(CONTRATO_DOS_PARTES, doc.caseId ?? created.id, {
      signatureRequestId: created.id,
      documentId: created.documentId,
      order: created.order,
      slaHours,
      signers: created.signers.map((s) => ({ signerId: s.signerId, name: s.name ?? undefined })),
    });

    await this.collab.audit({
      signatureRequestId: created.id,
      documentId: created.documentId,
      actorId: body.requestedBy ?? 'system',
      actorName: body.requestedByName,
      action: 'REQUEST_CREATED',
      payload: {
        methods: body.methods,
        order: created.order,
        slaHours,
        policyVersion: policy.version,
        policySource: policy.source,
      },
    });
    for (const signer of created.signers) {
      await this.collab.notify(
        signer.signerId,
        'Documento por firmar',
        `${body.requestedByName ?? 'Prestige'} te envió un documento.`,
        `/documents/${created.documentId}`,
      );
    }

    // M13 — correo de invitación con enlace de un solo uso a cada firmante.
    await this.mail.sendInvites(created.id).catch(() => undefined);

    return this.getOrThrow(created.id);
  }

  list(
    signerId?: string,
    status?: string,
    documentId?: string,
    requestedBy?: string,
    tenantId?: string,
  ) {
    return this.prisma.signatureRequest.findMany({
      where: {
        tenantId,
        documentId,
        requestedBy,
        status: status ? (status as never) : undefined,
        signers: signerId
          ? { some: { OR: [{ signerId }, { delegatedTo: signerId }] } }
          : undefined,
      },
      include: INCLUDE_SIGNERS,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrThrow(id: string, tenantId?: string) {
    const found = await this.prisma.signatureRequest.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: INCLUDE_SIGNERS,
    });
    if (!found) throw new NotFoundException(`Solicitud de firma ${id} no encontrada`);
    return found;
  }

  async recordConsent(
    id: string,
    body: { signerId: string; ip?: string; userAgent?: string },
  ) {
    await this.getOrThrow(id);
    const ipHash = createHash('sha256').update(body.ip ?? '0.0.0.0').digest('hex').slice(0, 32);
    const userAgentHash = body.userAgent
      ? createHash('sha256').update(body.userAgent).digest('hex').slice(0, 32)
      : null;
    return this.prisma.consentAcceptance.upsert({
      where: {
        signatureRequestId_signerId_textVersion: {
          signatureRequestId: id,
          signerId: body.signerId,
          textVersion: CONSENT_VERSION,
        },
      },
      create: {
        signatureRequestId: id,
        signerId: body.signerId,
        textVersion: CONSENT_VERSION,
        ipHash,
        userAgentHash,
      },
      update: { ipHash, userAgentHash, acceptedAt: new Date() },
    });
  }

  async sign(
    id: string,
    body: {
      signerId: string;
      method: SignatureMethod;
      biometricSessionId?: string;
      consentAccepted?: boolean;
      /** IP y user-agent REALES de la conexión (los pone el controller, no el cliente). */
      ip?: string;
      userAgent?: string;
    },
    autographImage?: Buffer,
  ) {
    const before = await this.prisma.signatureRequest.findUnique({ where: { id } });
    const wasAlreadyClosed = before ? ['COMPLETADA', 'RECHAZADA', 'EXPIRADA'].includes(before.status) : false;
    const signerBefore = before
      ? ((await this.prisma.signer.findFirst({
          where: { signatureRequestId: id, signerId: body.signerId },
        })) ??
        (await this.prisma.signer.findFirst({
          where: { signatureRequestId: id, delegatedTo: body.signerId },
        })))
      : null;
    const alreadySigned = signerBefore?.status === 'FIRMADO';

    if (!wasAlreadyClosed && !alreadySigned) {
      if (body.consentAccepted) {
        await this.recordConsent(id, {
          signerId: body.signerId,
          ip: body.ip,
          userAgent: body.userAgent,
        });
      } else {
        const consent = await this.prisma.consentAcceptance.findUnique({
          where: {
            signatureRequestId_signerId_textVersion: {
              signatureRequestId: id,
              signerId: body.signerId,
              textVersion: CONSENT_VERSION,
            },
          },
        });
        if (!consent) {
          throw new BadRequestException('Debes aceptar el consentimiento versionado antes de firmar');
        }
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.signatureRequest.findUnique({
        where: { id },
        include: { ...INCLUDE_SIGNERS, document: true },
      });
      if (!request) throw new NotFoundException(`Solicitud de firma ${id} no encontrada`);

      if (['COMPLETADA', 'RECHAZADA', 'EXPIRADA'].includes(request.status)) {
        return request;
      }

      // El firmante puede actuar por sí mismo o como delegado (`delegatedTo`).
      const signer =
        request.signers.find((s) => s.signerId === body.signerId) ??
        request.signers.find((s) => s.delegatedTo === body.signerId);
      if (!signer) {
        throw new NotFoundException(`Firmante ${body.signerId} no está en la solicitud ${id}`);
      }
      if (signer.status === 'FIRMADO') return request;
      const onBehalfOf = signer.signerId !== body.signerId ? signer.signerId : undefined;

      if (!request.methods.includes(body.method)) {
        throw new BadRequestException(
          `Método ${body.method} no autorizado para esta solicitud (permitidos: ${request.methods.join(', ')})`,
        );
      }

      if (request.order === 'SECUENCIAL') {
        const pendingBefore = request.signers
          .filter((s) => s.sortOrder < signer.sortOrder)
          .some((s) => s.status === 'PENDIENTE');
        if (pendingBefore) {
          throw new BadRequestException(
            'Todavía hay firmantes anteriores pendientes en el orden secuencial',
          );
        }
      }

      // Reclamo ATÓMICO del hueco del firmante antes de firmar el PDF: si otra
      // petición concurrente con el mismo enlace de un solo uso (doble POST /
      // reintento) ya lo tomó, salimos sin volver a firmar ni pisar el PDF.
      const claim = await tx.signer.updateMany({
        where: { id: signer.id, status: { not: 'FIRMADO' } },
        data: { status: 'FIRMADO', signedAt: new Date(), usedMethod: body.method },
      });
      if (claim.count === 0) return request;

      // Recuadro de firma: el del firmante en el orden (aunque hoy firme un
      // delegado), o cualquiera del documento.
      const field =
        (await tx.signatureField.findFirst({
          where: { documentId: request.documentId, signerId: signer.signerId, type: 'SIGNATURE' },
        })) ??
        (await tx.signatureField.findFirst({
          where: { documentId: request.documentId, type: 'SIGNATURE' },
        }));

      // El PDF actual, descifrado desde el storage.
      const currentPdf = await this.storage.getObject(
        request.document.objectKey,
        request.document.enc as unknown as EncMeta,
      );

      const signed = await this.signing.sign({
        method: body.method,
        signerId: body.signerId,
        signerName: (onBehalfOf ? signer.delegatedToName : signer.name) ?? signer.name ?? undefined,
        documentId: request.documentId,
        documentHash: request.document.hash,
        pdfBytes: currentPdf,
        signatureImage: autographImage,
        field: field
          ? {
              page: field.page,
              xPct: field.xPct,
              yPct: field.yPct,
              widthPct: field.widthPct,
              heightPct: field.heightPct,
            }
          : undefined,
        biometricSessionId: body.biometricSessionId,
      });

      // Si el adaptador incrustó la firma (DIGITAL PAdES / AUTÓGRAFA), la nueva
      // versión del PDF se guarda cifrada en el storage.
      if (signed.signedPdf?.length) {
        const stored = await this.storage.putObject({
          prefix: 'documents',
          filename: request.document.filename,
          bytes: signed.signedPdf,
          contentType: 'application/pdf',
        });
        await tx.document.update({
          where: { id: request.documentId },
          data: {
            objectKey: stored.objectKey,
            enc: stored.enc as unknown as object,
            hash: stored.sha256,
            sizeBytes: stored.sizeBytes,
            version: { increment: 1 },
          },
        });
      }

      // (el estado FIRMADO del firmante ya se fijó en el reclamo atómico previo)

      const remaining = request.signers.filter((s) => s.id !== signer.id);
      const allSigned = remaining.every((s) => s.status === 'FIRMADO');

      const updated = await tx.signatureRequest.update({
        where: { id },
        data: { status: allSigned ? 'COMPLETADA' : 'EN_FIRMA' },
        include: INCLUDE_SIGNERS,
      });
      return Object.assign(updated, { lastSignResult: signed });
    });

    if (!wasAlreadyClosed && !alreadySigned) {
      const now = new Date().toISOString();
      // El firmante «de la fila»: por sí mismo o el que lo delegó.
      const filledSigner =
        result.signers.find((s) => s.signerId === body.signerId) ??
        result.signers.find((s) => s.delegatedTo === body.signerId);
      const onBehalfOf =
        filledSigner && filledSigner.signerId !== body.signerId ? filledSigner.signerId : undefined;
      const effectiveSignerId = onBehalfOf ?? body.signerId;
      const signerName =
        (onBehalfOf ? filledSigner?.delegatedToName : filledSigner?.name) ?? filledSigner?.name ?? undefined;
      this.realtime.notifyDocumentEvent(result.documentId, {
        type: 'SIGNATURE_APPLIED',
        actorId: body.signerId,
        actorName: signerName,
        at: now,
      });
      // La señal al workflow usa el firmante del orden, no el delegado.
      await this.workflow.signalSigned(result.id, effectiveSignerId);
      const sr = (result as { lastSignResult?: import('../signing/signer-adapter').SignResult })
        .lastSignResult;
      await this.collab.audit({
        signatureRequestId: result.id,
        documentId: result.documentId,
        actorId: body.signerId,
        actorName: signerName,
        action: 'SIGNATURE_APPLIED',
        payload: {
          method: body.method,
          onBehalfOf,
          algorithm: sr?.algorithm,
          provider: sr?.provider,
          signatureHash: sr?.signatureHash,
          certificate: sr?.certificate,
        },
      });
      if (result.requestedBy && result.requestedBy !== body.signerId) {
        await this.collab.notify(
          result.requestedBy,
          `${signerName ?? body.signerId} firmó`,
          `Método ${body.method}. Estado: ${result.status}.`,
          `/documents/${result.documentId}`,
        );
      }
      if (result.status === 'COMPLETADA') {
        this.realtime.notifyDocumentEvent(result.documentId, {
          type: 'REQUEST_COMPLETED',
          actorId: body.signerId,
          actorName: signerName,
          at: now,
        });
        await this.evidence.generateForRequest(result.id);
        await this.mail.sendCompleted(result.id).catch(() => undefined);
      }
    }

    return result;
  }

  async reject(id: string, body: { signerId: string; reason?: string }) {
    const request = await this.getOrThrow(id);
    if (['COMPLETADA', 'RECHAZADA', 'EXPIRADA'].includes(request.status)) return request;
    await this.prisma.signer.updateMany({
      where: { signatureRequestId: id, signerId: body.signerId },
      data: { status: 'RECHAZADO' },
    });
    const updated = await this.prisma.signatureRequest.update({
      where: { id },
      data: { status: 'RECHAZADA' },
      include: INCLUDE_SIGNERS,
    });
    await this.workflow.signalRejected(id, body.signerId);
    await this.collab.audit({
      signatureRequestId: id,
      documentId: updated.documentId,
      actorId: body.signerId,
      action: 'REQUEST_REJECTED',
      payload: { reason: body.reason },
    });
    return updated;
  }

  async cancel(id: string, body: { actorId?: string }) {
    const request = await this.getOrThrow(id);
    if (['COMPLETADA', 'RECHAZADA', 'EXPIRADA'].includes(request.status)) return request;
    const updated = await this.prisma.signatureRequest.update({
      where: { id },
      data: { status: 'RECHAZADA' },
      include: INCLUDE_SIGNERS,
    });
    await this.workflow.signalRejected(id, body.actorId ?? request.requestedBy ?? 'system');
    return updated;
  }

  async delegate(
    id: string,
    body: { fromSignerId: string; toSignerId: string; toName?: string; reason?: string; auto?: boolean },
  ) {
    const request = await this.getOrThrow(id);
    const signer = request.signers.find((s) => s.signerId === body.fromSignerId);
    if (!signer) throw new NotFoundException('Firmante no encontrado');
    if (signer.status !== 'PENDIENTE') {
      throw new BadRequestException('Solo se puede delegar una firma pendiente');
    }
    if (body.toSignerId === body.fromSignerId) {
      throw new BadRequestException('No puedes delegarte una firma a ti mismo');
    }
    await this.prisma.signer.update({
      where: { id: signer.id },
      data: { delegatedTo: body.toSignerId, delegatedToName: body.toName },
    });
    // Las tareas humanas abiertas pasan a la bandeja del delegado.
    await this.workflow.reassignForDelegation(id, body.fromSignerId, body.toSignerId);
    await this.collab.audit({
      signatureRequestId: id,
      documentId: request.documentId,
      actorId: body.auto ? 'system' : body.fromSignerId,
      action: 'DELEGATED',
      payload: {
        fromSignerId: body.fromSignerId,
        toSignerId: body.toSignerId,
        toName: body.toName,
        reason: body.reason,
        auto: Boolean(body.auto),
      },
    });
    await this.collab.notify(
      body.toSignerId,
      'Te delegaron una firma',
      `${signer.name ?? body.fromSignerId} te delegó un documento.`,
      `/documents/${request.documentId}`,
    );
    return this.getOrThrow(id);
  }

  /**
   * M07 — al crear la solicitud, fija en `Signer.delegatedTo` la delegación de
   * cada firmante con una regla «fuera de oficina» vigente. Las tareas humanas
   * (WorkflowService.seedTasks) se siembran luego ya a nombre del suplente.
   */
  private async applyOutOfOffice(
    requestId: string,
    documentId: string,
    signers: { signerId: string; name?: string | null }[],
  ) {
    if (signers.length === 0) return;
    const now = new Date();
    const rules = await this.prisma.outOfOffice.findMany({
      where: {
        userId: { in: signers.map((s) => s.signerId) },
        since: { lte: now },
        OR: [{ until: null }, { until: { gt: now } }],
      },
    });
    for (const rule of rules) {
      if (rule.delegateId === rule.userId) continue;
      await this.prisma.signer.updateMany({
        where: { signatureRequestId: requestId, signerId: rule.userId, status: 'PENDIENTE' },
        data: { delegatedTo: rule.delegateId, delegatedToName: rule.delegateName },
      });
      await this.collab.audit({
        signatureRequestId: requestId,
        documentId,
        actorId: 'system',
        action: 'DELEGATED',
        payload: {
          fromSignerId: rule.userId,
          toSignerId: rule.delegateId,
          toName: rule.delegateName,
          reason: rule.reason,
          auto: true,
        },
      });
      await this.collab.notify(
        rule.delegateId,
        'Te delegaron una firma',
        `${signers.find((s) => s.signerId === rule.userId)?.name ?? rule.userId} está fuera de oficina y te delegó un documento.`,
        `/documents/${documentId}`,
      );
    }
  }
}
