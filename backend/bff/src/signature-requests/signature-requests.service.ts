import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { SignatureMethod, SignerRole, SigningOrder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { EvidenceService } from '../evidence/evidence.service';
import { WorkflowService } from '../workflow/workflow.service';
import { SigningRouter } from '../signing/signing.router';
import { PdfStampService } from '../signing/pdf-stamp.service';
import { requestTimestamp } from '../signing/tsa/rfc3161';
import { StorageService } from '../storage/storage.service';
import type { EncMeta } from '../storage/object-crypto';
import { CONSENT_TEXT, CONSENT_VERSION } from '../consent/consent';
import { CONTRATO_DOS_PARTES } from '../temporal/shared';
import { CollaborationService } from '../collaboration/collaboration.service';
import { SignerMailService } from '../notifications/signer-mail.service';
import { SignaturePolicyService } from '../signing/signature-policy';
import { PasskeyCeremonyService } from '../webauthn/passkey-ceremony.service';

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
    private readonly passkeys: PasskeyCeremonyService,
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

  /**
   * Normaliza la identidad de los firmantes contra `TenantMembership`. Si el
   * `signerId` o el correo entrante coincide (sin distinguir mayúsculas) con un
   * miembro activo del tenant, se adopta su `userId` canónico y se completan
   * nombre/correo que falten. Los que no coinciden quedan como firmantes
   * externos (solo correo + enlace de un solo uso), como antes.
   */
  private async resolveSigners(
    tenantId: string,
    signers: { signerId: string; name?: string; email?: string; role?: SignerRole }[],
  ) {
    const members = await this.prisma.tenantMembership.findMany({
      // `tenantId` (del JWT) puede venir como slug o como id; `TenantMembership`
      // guarda el id. Se acepta cualquiera.
      where: { tenant: { OR: [{ id: tenantId }, { slug: tenantId }] }, active: true },
      select: { userId: true, name: true, email: true },
    });
    const byKey = new Map<string, { userId: string; name: string | null; email: string | null }>();
    for (const m of members) {
      byKey.set(m.userId.toLowerCase(), m);
      if (m.email) byKey.set(m.email.toLowerCase(), m);
    }
    return signers.map((s) => {
      const hit =
        byKey.get(s.signerId.trim().toLowerCase()) ??
        (s.email ? byKey.get(s.email.trim().toLowerCase()) : undefined);
      if (!hit) return s;
      return {
        ...s,
        signerId: hit.userId,
        name: s.name ?? hit.name ?? undefined,
        email: s.email ?? hit.email ?? undefined,
      };
    });
  }

  /**
   * SECUENCIAL — tras cerrar una firma y quedar la solicitud EN_FIRMA, avisa al
   * siguiente firmante pendiente del orden ("es tu turno"): notificación in-app,
   * correo de invitación, prioridad alta en su tarea y evento de auditoría.
   * Idempotente: si ya hay un `SIGNATURE_TURN` para ese firmante, no repite.
   */
  private async notifyNextInSequence(request: {
    id: string;
    documentId: string;
    signers: { signerId: string; name: string | null; status: string; sortOrder: number }[];
  }) {
    const next = [...request.signers]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .find((s) => s.status === 'PENDIENTE');
    if (!next) return;

    const already = await this.prisma.processAuditEvent.count({
      where: {
        signatureRequestId: request.id,
        action: 'SIGNATURE_TURN',
        payload: { path: ['signerId'], equals: next.signerId },
      },
    });
    if (already > 0) return;

    const doc = await this.prisma.document.findUnique({
      where: { id: request.documentId },
      select: { filename: true },
    });
    const docTitle = doc?.filename ?? 'un documento';

    await this.collab.notify(
      next.signerId,
      'Es tu turno de firmar',
      `Ya puedes firmar «${docTitle}».`,
      '/inbox',
    );
    await this.mail.sendInvite(request.id, next.signerId).catch(() => undefined);
    await this.prisma.humanTask.updateMany({
      where: {
        signatureRequestId: request.id,
        status: { in: ['CREADA', 'ASIGNADA'] },
        OR: [{ signerId: next.signerId }, { delegatedFrom: next.signerId }],
      },
      data: { priority: 2 },
    });
    await this.collab.audit({
      signatureRequestId: request.id,
      documentId: request.documentId,
      actorId: 'system',
      action: 'SIGNATURE_TURN',
      payload: { signerId: next.signerId, sortOrder: next.sortOrder },
    });
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
      methods: body.methods as unknown as ('DIGITAL' | 'AUTOGRAFA' | 'BIOMETRICA' | 'ACCEPT')[],
      order: body.order,
      slaHours: body.slaHours,
    });
    const slaHours = enforced.slaHours;
    const expiresAt = new Date(Date.now() + slaHours * 3600_000);
    // Resuelve la identidad de cada firmante contra el directorio del tenant:
    // si coincide un miembro registrado, se usa su `userId` canónico para que
    // la solicitud caiga en su bandeja (que filtra por username, no por correo).
    const signers = await this.resolveSigners(doc.tenantId, body.signers);
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
          create: signers.map((s, index) => ({
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
    // Aviso in-app: en SECUENCIAL solo al primer firmante del orden; los demás
    // reciben el suyo al pasarles el turno (`notifyNextInSequence`). En PARALELO,
    // a todos de una vez.
    const notifyAtCreate =
      created.order === 'SECUENCIAL' ? created.signers.slice(0, 1) : created.signers;
    for (const signer of notifyAtCreate) {
      await this.collab.notify(
        signer.signerId,
        'Documento por firmar',
        `${body.requestedByName ?? 'Prestige'} te envió un documento.`,
        `/documents/${created.documentId}`,
      );
    }

    // M13 — correo de invitación con enlace de un solo uso.
    if (created.order === 'SECUENCIAL') {
      const first = created.signers[0];
      if (first) await this.mail.sendInvite(created.id, first.signerId).catch(() => undefined);
    } else {
      await this.mail.sendInvites(created.id).catch(() => undefined);
    }

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
      /** Verificación WebAuthn ya resuelta en `/passkey/finish`, pendiente de consumir. */
      passkeyAssertionId?: string;
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
      if (signer.status === 'FIRMADO' || signer.status === 'RECHAZADO') return request;
      const onBehalfOf = signer.signerId !== body.signerId ? signer.signerId : undefined;
      const isReconcileRetry = signer.status === 'PENDIENTE' && Boolean(signer.pendingRef);
      if (isReconcileRetry) {
        // Ya hay una firma asíncrona en curso (2FA/biometría esperando al
        // proveedor). No se vuelve a reclamar ni a invocar al proveedor —
        // signature-reconcile.service la cierra cuando el proveedor responda.
        return request;
      }

      if (!request.methods.includes(body.method)) {
        throw new BadRequestException(
          `Método ${body.method} no autorizado para esta solicitud (permitidos: ${request.methods.join(', ')})`,
        );
      }

      if (request.requirePasskey && body.method !== 'PASSKEY') {
        if (!body.passkeyAssertionId) {
          throw new ForbiddenException('Esta solicitud exige verificación con passkey antes de firmar');
        }
        // `consume` usa `this.prisma` (fuera de `tx`): si la solicitud se
        // recarga después y algo más abajo revienta, la aserción queda
        // gastada sin firma aplicada — aceptable, un caso raro que solo
        // obliga a pedir una passkey nueva; no vale la pena pasar `tx` a un
        // servicio de otro módulo solo para este borde.
        await this.passkeys.consume({
          assertionId: body.passkeyAssertionId,
          tenantId: request.tenantId,
          signatureRequestId: request.id,
          signerId: signer.signerId,
        });
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

      // Reclamo ATÓMICO del hueco: PENDIENTE → EN_PROCESO. Si otra petición
      // concurrente ya lo tomó (o ya firmó / rechazó), salimos sin re-firmar ni
      // pisar el PDF. La firma se marca FIRMADO sólo si el adaptador NO devuelve
      // `pending` (métodos asíncronos vuelven a PENDIENTE con un `pendingRef`).
      const claim = await tx.signer.updateMany({
        where: { id: signer.id, status: 'PENDIENTE' },
        data: { status: 'EN_PROCESO', usedMethod: body.method },
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

      // Canónico: se rehashea antes de aceptar si ya está congelado.
      // La ceremonia firma la copia presentada (o el canónico la primera vez)
      // y escribe el resultado en presented*, nunca encima de objectKey.
      const canonicalPdf = await this.storage.getObject(
        request.document.objectKey,
        request.document.enc as unknown as EncMeta,
      );
      const liveCanonical = createHash('sha256').update(canonicalPdf).digest('hex');
      if (request.document.locked && liveCanonical !== request.document.hash) {
        throw new ConflictException({
          error: 'HASH_MISMATCH',
          message: 'El PDF congelado no coincide con el objeto en storage',
        });
      }
      const currentPdf = request.document.presentedObjectKey
        ? await this.storage.getObject(
            request.document.presentedObjectKey,
            request.document.presentedEnc as unknown as EncMeta,
          )
        : canonicalPdf;

      const signed = await this.signing.sign({
        method: body.method,
        signerId: body.signerId,
        signerName: (onBehalfOf ? signer.delegatedToName : signer.name) ?? signer.name ?? undefined,
        documentId: request.documentId,
        tenantId: request.tenantId,
        signatureRequestId: request.id,
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
        passkeyAssertionId: body.passkeyAssertionId,
      });

      // Fase B — firma asíncrona: el adaptador la inició pero falta la
      // confirmación del proveedor (2FA / biometría). Volvemos a PENDIENTE con
      // un `pendingRef` para que el reconciliador la cierre luego.
      if (signed.pending) {
        await tx.signer.update({
          where: { id: signer.id },
          data: {
            status: 'PENDIENTE',
            usedMethod: body.method,
            pendingRef: signed.pendingRef ?? `pending-${signer.id}`,
            pendingSince: new Date(),
          },
        });
        const stillPending = await tx.signatureRequest.update({
          where: { id },
          data: { status: 'EN_FIRMA' },
          include: INCLUDE_SIGNERS,
        });
        return Object.assign(stillPending, { lastSignResult: signed, pendingResult: true as const });
      }

      // La firma incrustada (PAdES / autógrafa) es una copia. El canónico
      // (`objectKey` + `hash`) no se toca: es el PDF congelado.
      let strokeObjectKey: string | undefined;
      if (autographImage?.length) {
        const stroke = await this.storage.putObject({
          prefix: `evidence/${request.document.tenantId}`,
          filename: `${signer.id}-stroke.png`,
          bytes: autographImage,
          contentType: 'image/png',
        });
        strokeObjectKey = stroke.objectKey;
      }
      if (signed.signedPdf?.length) {
        const stored = await this.storage.putObject({
          prefix: `presented/${request.document.tenantId}`,
          filename: request.document.filename,
          bytes: signed.signedPdf,
          contentType: 'application/pdf',
        });
        await tx.document.update({
          where: { id: request.documentId },
          data: {
            presentedObjectKey: stored.objectKey,
            presentedEnc: stored.enc as unknown as object,
            presentedHash: stored.sha256,
          },
        });
      }

      // Firma concluida: EN_PROCESO → FIRMADO (limpia el pendiente si lo había).
      await tx.signer.update({
        where: { id: signer.id },
        data: {
          status: 'FIRMADO',
          signedAt: new Date(),
          usedMethod: body.method,
          pendingRef: null,
          pendingSince: null,
        },
      });

      const remaining = request.signers.filter((s) => s.id !== signer.id);
      const allSigned = remaining.every((s) => s.status === 'FIRMADO');

      const updated = await tx.signatureRequest.update({
        where: { id },
        data: { status: allSigned ? 'COMPLETADA' : 'EN_FIRMA' },
        include: INCLUDE_SIGNERS,
      });
      return Object.assign(updated, { lastSignResult: signed, strokeObjectKey });
    });

    // Fase B — firma asíncrona iniciada: audita y espera al reconciliador.
    if ((result as { pendingResult?: boolean }).pendingResult) {
      const sr = (result as { lastSignResult?: import('../signing/signer-adapter').SignResult })
        .lastSignResult;
      await this.collab.audit({
        signatureRequestId: result.id,
        documentId: result.documentId,
        actorId: body.signerId,
        action: 'SIGNATURE_PENDING',
        payload: { method: body.method, provider: sr?.provider, pendingRef: sr?.pendingRef, detail: sr?.detail },
      });
      if (result.requestedBy && result.requestedBy !== body.signerId) {
        await this.collab.notify(
          result.requestedBy,
          `${body.signerId} inició su firma`,
          `Firma ${body.method} en curso; falta la confirmación del proveedor.`,
          `/documents/${result.documentId}`,
        );
      }
      return result;
    }

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
      const sr = (result as { lastSignResult?: import('../signing/signer-adapter').SignResult })
        .lastSignResult;

      // Fase B — sello de tiempo RFC 3161 POR EVENTO sobre el hash de esta firma
      // (además del sello del paquete). Best-effort: un fallo de la TSA no
      // bloquea la firma.
      let eventTimestamp: { provider: string; tokenHash: string; issuedAt: string } | undefined;
      if (sr?.signatureHash && /^[0-9a-f]{64}$/i.test(sr.signatureHash)) {
        try {
          const ts = await requestTimestamp(Buffer.from(sr.signatureHash, 'hex'));
          if (ts) {
            const tokenHash = createHash('sha256').update(ts.token).digest('hex');
            const issuedAt = new Date(ts.info.genTime);
            await this.prisma.signatureEventTimestamp.upsert({
              where: { signatureRequestId_signerId: { signatureRequestId: result.id, signerId: effectiveSignerId } },
              create: {
                signatureRequestId: result.id,
                signerId: effectiveSignerId,
                signedHash: sr.signatureHash,
                provider: ts.tsaUrl,
                tokenHash,
                token: ts.token.toString('base64'),
                issuedAt,
              },
              update: { signedHash: sr.signatureHash, provider: ts.tsaUrl, tokenHash, token: ts.token.toString('base64'), issuedAt },
            });
            eventTimestamp = { provider: ts.tsaUrl, tokenHash, issuedAt: issuedAt.toISOString() };
          }
        } catch (error) {
          // sin sello por evento; el sello del paquete sigue vigente
          void error;
        }
      }

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
          eventTimestamp,
          strokeObjectKey: (result as { strokeObjectKey?: string }).strokeObjectKey,
        },
      });

      // La señal al workflow (que puede disparar el sellado) va DESPUÉS de que
      // el evento SIGNATURE_APPLIED con su sello por evento esté persistido.
      await this.workflow.signalSigned(result.id, effectiveSignerId);

      if (result.requestedBy && result.requestedBy !== body.signerId) {
        await this.collab.notify(
          result.requestedBy,
          `${signerName ?? body.signerId} firmó`,
          `Método ${body.method}. Estado: ${result.status}.`,
          `/documents/${result.documentId}`,
        );
      }
      if (result.status === 'EN_FIRMA' && result.order === 'SECUENCIAL') {
        await this.notifyNextInSequence(result).catch(() => undefined);
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

  /**
   * Fase B — cierra una firma que quedó `pending` cuando el proveedor asíncrono
   * confirma (o rechaza). Idempotente: si el firmante ya no está pendiente, no
   * hace nada.
   */
  async finalizePending(
    signatureRequestId: string,
    signerId: string,
    r: { status: 'completed' | 'failed'; signatureHash?: string; signedPdf?: Buffer; reason?: string },
  ) {
    const request = await this.prisma.signatureRequest.findUnique({
      where: { id: signatureRequestId },
      include: { ...INCLUDE_SIGNERS, document: true },
    });
    if (!request || ['COMPLETADA', 'RECHAZADA', 'EXPIRADA'].includes(request.status)) return;
    const signer = request.signers.find(
      (s) => (s.signerId === signerId || s.delegatedTo === signerId) && s.status === 'PENDIENTE' && s.pendingRef,
    );
    if (!signer) return;

    if (r.status === 'failed') {
      await this.prisma.signer.update({
        where: { id: signer.id },
        data: { status: 'RECHAZADO', pendingRef: null, pendingSince: null },
      });
      await this.prisma.signatureRequest.update({
        where: { id: signatureRequestId },
        data: { status: 'RECHAZADA' },
      });
      await this.workflow.signalRejected(signatureRequestId, signer.signerId);
      await this.collab.audit({
        signatureRequestId,
        documentId: request.documentId,
        actorId: signer.signerId,
        action: 'SIGNATURE_FAILED',
        payload: { reason: r.reason, reconciled: true },
      });
      return;
    }

    // completed
    const signatureHash = r.signatureHash ?? request.document.hash;
    const completed = await this.prisma.$transaction(async (tx) => {
      if (r.signedPdf?.length) {
        const stored = await this.storage.putObject({
          prefix: `presented/${request.document.tenantId}`,
          filename: request.document.filename,
          bytes: r.signedPdf,
          contentType: 'application/pdf',
        });
        await tx.document.update({
          where: { id: request.documentId },
          data: {
            presentedObjectKey: stored.objectKey,
            presentedEnc: stored.enc as unknown as object,
            presentedHash: stored.sha256,
          },
        });
      }
      await tx.signer.update({
        where: { id: signer.id },
        data: { status: 'FIRMADO', signedAt: new Date(), pendingRef: null, pendingSince: null },
      });
      const remaining = request.signers.filter((s) => s.id !== signer.id);
      const allSigned = remaining.every((s) => s.status === 'FIRMADO');
      return tx.signatureRequest.update({
        where: { id: signatureRequestId },
        data: { status: allSigned ? 'COMPLETADA' : 'EN_FIRMA' },
        include: INCLUDE_SIGNERS,
      });
    });

    await this.collab.audit({
      signatureRequestId,
      documentId: request.documentId,
      actorId: signer.signerId,
      actorName: signer.name ?? undefined,
      action: 'SIGNATURE_APPLIED',
      payload: { method: signer.usedMethod, signatureHash, reconciled: true },
    });
    await this.workflow.signalSigned(signatureRequestId, signer.signerId);
    if (completed.status === 'COMPLETADA') {
      await this.evidence.generateForRequest(signatureRequestId);
      await this.mail.sendCompleted(signatureRequestId).catch(() => undefined);
    }
  }

  /** Firmantes con una firma asíncrona a la espera (para el reconciliador). */
  pendingSignatures(olderThanSeconds = 20) {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
    return this.prisma.signer.findMany({
      where: { status: 'PENDIENTE', pendingRef: { not: null }, pendingSince: { lt: cutoff } },
      include: { signatureRequest: { include: { document: true } } },
      take: 50,
    });
  }

  async reject(id: string, body: { signerId: string; reason?: string }, tenantId?: string) {
    const request = await this.getOrThrow(id, tenantId);
    if (['COMPLETADA', 'RECHAZADA', 'EXPIRADA'].includes(request.status)) return request;
    const claimed = await this.prisma.signer.updateMany({
      where: { signatureRequestId: id, signerId: body.signerId },
      data: { status: 'RECHAZADO' },
    });
    if (claimed.count === 0) {
      throw new ForbiddenException('No eres firmante de esta solicitud');
    }
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
