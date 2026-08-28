import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { SignatureMethod, SignerRole, SigningOrder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { EvidenceService } from '../evidence/evidence.service';
import { WorkflowService } from '../workflow/workflow.service';
import { SigningRouter } from '../signing/signing.router';
import { PdfStampService } from '../signing/pdf-stamp.service';
import { CONSENT_TEXT, CONSENT_VERSION } from '../consent/consent';
import { CONTRATO_DOS_PARTES } from '../temporal/shared';
import { CollaborationService } from '../collaboration/collaboration.service';

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
    private readonly collab: CollaborationService,
  ) {}

  consentText() {
    return { version: CONSENT_VERSION, text: CONSENT_TEXT };
  }

  capabilities() {
    return this.signing.capabilities();
  }

  async create(body: {
    documentId: string;
    methods: SignatureMethod[];
    order?: SigningOrder;
    requestedBy?: string;
    requestedByName?: string;
    slaHours?: number;
    signers: { signerId: string; name?: string; email?: string; role?: SignerRole }[];
  }) {
    if (!body.methods?.length) {
      throw new BadRequestException('Debes autorizar al menos un método de firma');
    }
    const slaHours = body.slaHours ?? 72;
    const expiresAt = new Date(Date.now() + slaHours * 3600_000);
    const created = await this.prisma.signatureRequest.create({
      data: {
        documentId: body.documentId,
        methods: body.methods,
        order: body.order ?? 'SECUENCIAL',
        requestedBy: body.requestedBy,
        requestedByName: body.requestedByName,
        slaHours,
        expiresAt,
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

    const document = await this.prisma.document.findUnique({ where: { id: body.documentId } });
    await this.workflow.startInstance(CONTRATO_DOS_PARTES, document?.caseId ?? created.id, {
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
      payload: { methods: body.methods, order: created.order, slaHours },
    });
    for (const signer of created.signers) {
      await this.collab.notify(
        signer.signerId,
        'Documento por firmar',
        `${body.requestedByName ?? 'Prestige'} te envió un documento.`,
        `/documents/${created.documentId}`,
      );
    }

    return created;
  }

  list(signerId?: string, status?: string, documentId?: string, requestedBy?: string) {
    return this.prisma.signatureRequest.findMany({
      where: {
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

  async getOrThrow(id: string) {
    const found = await this.prisma.signatureRequest.findUnique({
      where: { id },
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
      signatureImageBase64?: string;
      biometricSessionId?: string;
      consentAccepted?: boolean;
    },
  ) {
    const before = await this.prisma.signatureRequest.findUnique({ where: { id } });
    const wasAlreadyClosed = before ? ['COMPLETADA', 'RECHAZADA', 'EXPIRADA'].includes(before.status) : false;
    const signerBefore = before
      ? await this.prisma.signer.findFirst({ where: { signatureRequestId: id, signerId: body.signerId } })
      : null;
    const alreadySigned = signerBefore?.status === 'FIRMADO';

    if (!wasAlreadyClosed && !alreadySigned) {
      if (body.consentAccepted) {
        await this.recordConsent(id, { signerId: body.signerId });
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

      const signer = request.signers.find((s) => s.signerId === body.signerId);
      if (!signer) {
        throw new NotFoundException(`Firmante ${body.signerId} no está en la solicitud ${id}`);
      }
      if (signer.status === 'FIRMADO') return request;

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

      const signed = await this.signing.sign({
        method: body.method,
        signerId: body.signerId,
        documentHash: request.document.hash,
        signatureImageBase64: body.signatureImageBase64,
        biometricSessionId: body.biometricSessionId,
      });

      if (body.method === 'AUTOGRAFA' && body.signatureImageBase64) {
        const field =
          (await tx.signatureField.findFirst({
            where: { documentId: request.documentId, signerId: body.signerId, type: 'SIGNATURE' },
          })) ??
          (await tx.signatureField.findFirst({
            where: { documentId: request.documentId, type: 'SIGNATURE' },
          }));
        const stamped = await this.stamp.stampAutograph(
          request.document.contentBase64,
          body.signatureImageBase64,
          field ?? undefined,
        );
        const hash = createHash('sha256').update(stamped, 'base64').digest('hex');
        await tx.document.update({
          where: { id: request.documentId },
          data: { contentBase64: stamped, hash, version: { increment: 1 } },
        });
      }

      await tx.signer.update({
        where: { id: signer.id },
        data: { status: 'FIRMADO', signedAt: new Date(), usedMethod: body.method },
      });

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
      const signerName = result.signers.find((s) => s.signerId === body.signerId)?.name ?? undefined;
      this.realtime.notifyDocumentEvent(result.documentId, {
        type: 'SIGNATURE_APPLIED',
        actorId: body.signerId,
        actorName: signerName,
        at: now,
      });
      await this.workflow.signalSigned(result.id, body.signerId);
      await this.collab.audit({
        signatureRequestId: result.id,
        documentId: result.documentId,
        actorId: body.signerId,
        actorName: signerName,
        action: 'SIGNATURE_APPLIED',
        payload: { method: body.method },
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
    body: { fromSignerId: string; toSignerId: string; toName?: string },
  ) {
    const request = await this.getOrThrow(id);
    const signer = request.signers.find((s) => s.signerId === body.fromSignerId);
    if (!signer) throw new NotFoundException('Firmante no encontrado');
    if (signer.status !== 'PENDIENTE') {
      throw new BadRequestException('Solo se puede delegar una firma pendiente');
    }
    await this.prisma.signer.update({
      where: { id: signer.id },
      data: { delegatedTo: body.toSignerId, delegatedToName: body.toName },
    });
    await this.collab.audit({
      signatureRequestId: id,
      documentId: request.documentId,
      actorId: body.fromSignerId,
      action: 'DELEGATED',
      payload: { toSignerId: body.toSignerId, toName: body.toName },
    });
    await this.collab.notify(
      body.toSignerId,
      'Te delegaron una firma',
      `${signer.name ?? body.fromSignerId} te delegó un documento.`,
      `/documents/${request.documentId}`,
    );
    return this.getOrThrow(id);
  }
}
