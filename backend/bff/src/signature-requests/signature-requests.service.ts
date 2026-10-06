import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  KycPolicy,
  RequestStatus,
  SignatureMethod,
  SignerRole,
  SignerStatus,
  SigningOrder,
} from '@prisma/client';
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
import { DocumentsService } from '../documents/documents.service';
import { allowedMethodsForRequest, creationWarnings } from './allowed-methods';
import { STABLE_ORDER, finishPage, mapPage, pageArgs, prismaPage, type PageQueryDto } from '../common/pagination';

export type { SignatureMethod, SigningOrder, SignerRole, KycPolicy };

const INCLUDE_SIGNERS = { signers: { orderBy: { sortOrder: 'asc' as const } } };
/** Sprint 4 — vigencia de un alta HABILITADO para `kycPolicy=ONCE` (SPEC §9). */
const KYC_ONCE_MAX_AGE_MS = 90 * 24 * 3600_000;
const CLOSED_REQUEST: string[] = ['COMPLETADA', 'RECHAZADA', 'EXPIRADA'];
const OPEN_REQUEST: RequestStatus[] = ['PENDIENTE', 'EN_FIRMA'];
const OPEN_SIGNER: SignerStatus[] = ['PENDIENTE', 'EN_PROCESO'];
/** La transacción de firma incluye I/O de storage y del adaptador (PAdES/biometría). */
const SIGN_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

/** Respuesta mínima de `sign()`: nunca el PDF ni datos de otros firmantes. */
export interface SignOutcome {
  status: SignerStatus;
  signedAt: Date | null;
  requestStatus: RequestStatus;
}

interface ActorSigner {
  id: string;
  signerId: string;
  status: string;
  sortOrder: number;
  delegatedTo: string | null;
}

/**
 * Filas de `Signer` en las que `actorId` puede actuar: la suya propia SÓLO si no
 * la delegó (tras delegar, el firmante original ya no firma ni rechaza) o
 * aquéllas que le delegaron a él.
 */
function actingCandidates<T extends ActorSigner>(signers: T[], actorId: string): T[] {
  return signers.filter((s) => (s.delegatedTo ? s.delegatedTo === actorId : s.signerId === actorId));
}

/** Prefiere la fila abierta de menor orden; si no hay, la primera candidata. */
function pickSigner<T extends ActorSigner>(candidates: T[]): T | undefined {
  const open = candidates
    .filter((s) => (OPEN_SIGNER as string[]).includes(s.status))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return open[0] ?? candidates[0];
}

@Injectable()
export class SignatureRequestsService {
  private readonly log = new Logger(SignatureRequestsService.name);

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
    private readonly documents: DocumentsService,
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
    tenantId?: string;
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
      request.tenantId,
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

  /** Sprint 5 — defaults reutilizables. `templateId` llena lo que el cuerpo no traiga explícito. */
  async createTemplate(body: {
    tenantId: string;
    name: string;
    order?: SigningOrder;
    kycPolicy?: KycPolicy;
    allowedMethods: SignatureMethod[];
    requirePasskey?: boolean;
    slaHours?: number;
  }) {
    return this.prisma.envelopeTemplate.create({
      data: {
        tenantId: body.tenantId,
        name: body.name,
        order: body.order ?? 'SECUENCIAL',
        kycPolicy: body.kycPolicy ?? 'NONE',
        allowedMethods: body.allowedMethods,
        requirePasskey: body.requirePasskey ?? false,
        slaHours: body.slaHours ?? 72,
      },
    });
  }

  listTemplates(tenantId: string) {
    return this.prisma.envelopeTemplate.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async create(body: {
    documentId: string;
    templateId?: string;
    methods?: SignatureMethod[];
    order?: SigningOrder;
    requestedBy?: string;
    requestedByName?: string;
    tenantId: string;
    slaHours?: number;
    signers: { signerId: string; name?: string; email?: string; role?: SignerRole }[];
    requirePasskey?: boolean;
    kycPolicy?: KycPolicy;
  }) {
    let template: { order: SigningOrder; kycPolicy: KycPolicy; allowedMethods: SignatureMethod[]; requirePasskey: boolean; slaHours: number } | null = null;
    if (body.templateId) {
      template = await this.prisma.envelopeTemplate.findFirst({
        where: { id: body.templateId, tenantId: body.tenantId },
      });
      if (!template) throw new NotFoundException(`Plantilla ${body.templateId} no encontrada`);
    }

    const methods = body.methods?.length ? body.methods : (template?.allowedMethods ?? []);
    if (!methods.length) {
      throw new BadRequestException('Debes autorizar al menos un método de firma');
    }
    const requirePasskey = body.requirePasskey ?? template?.requirePasskey ?? false;
    const kycPolicy = body.kycPolicy ?? template?.kycPolicy ?? 'NONE';

    // A-07 — el documento debe ser del tenant del solicitante.
    const doc = await this.prisma.document.findFirst({
      where: { id: body.documentId, tenantId: body.tenantId },
      select: { id: true, tenantId: true, caseId: true },
    });
    if (!doc) throw new NotFoundException(`Documento ${body.documentId} no encontrado`);

    // BIOMETRICA sólo si hay proveedor configurado: si no, la solicitud nacería
    // con un método imposible de completar.
    if (methods.includes('BIOMETRICA')) {
      const bio = this.signing.capabilities().find((c) => c.method === 'BIOMETRICA');
      if (bio && bio.configured === false) {
        throw new BadRequestException(
          'El método BIOMETRICA no está disponible: no hay proveedor biométrico configurado',
        );
      }
    }

    // M10 — política de firma del tenant: valida los métodos y aplica defaults.
    const policy = await this.policyService.resolve(body.tenantId);
    const enforced = this.policyService.enforce(policy, {
      methods: methods as unknown as ('DIGITAL' | 'AUTOGRAFA' | 'BIOMETRICA' | 'ACCEPT' | 'PASSKEY')[],
      order: body.order ?? template?.order,
      slaHours: body.slaHours ?? template?.slaHours,
    });
    const slaHours = enforced.slaHours;
    const expiresAt = new Date(Date.now() + slaHours * 3600_000);
    // Resuelve la identidad de cada firmante contra el directorio del tenant:
    // si coincide un miembro registrado, se usa su `userId` canónico para que
    // la solicitud caiga en su bandeja (que filtra por username, no por correo).
    const signers = await this.resolveSigners(doc.tenantId, body.signers);
    // FREEZE obligatorio: el canónico se congela (con verificación de hash
    // contra storage) antes de abrir la solicitud. Idempotente si ya lo estaba.
    await this.documents.freeze(doc.id, doc.tenantId, body.requestedBy ?? 'system', body.requestedByName);
    const created = await this.prisma.signatureRequest.create({
      data: {
        documentId: body.documentId,
        tenantId: doc.tenantId,
        methods,
        order: enforced.order,
        requestedBy: body.requestedBy,
        requestedByName: body.requestedByName,
        slaHours,
        expiresAt,
        policyVersion: policy.version,
        policySnapshot: policy as unknown as object,
        requirePasskey,
        kycPolicy,
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
      created.tenantId,
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
        methods,
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
        created.tenantId,
      );
    }

    // M13 — correo de invitación con enlace de un solo uso.
    if (created.order === 'SECUENCIAL') {
      const first = created.signers[0];
      if (first) await this.mail.sendInvite(created.id, first.signerId).catch(() => undefined);
    } else {
      await this.mail.sendInvites(created.id).catch(() => undefined);
    }

    // Los firmantes posteriores a una firma DIGITAL no podrán usar métodos
    // visuales (ver allowed-methods.ts): se avisa, no se rechaza.
    const warnings = creationWarnings(created.order, methods);
    return { ...(await this.getOrThrow(created.id, doc.tenantId)), warnings };
  }

  /** Listado paginado (ver `common/pagination`): array sin limit/cursor, `{items,nextCursor}` con ellos. */
  async list(
    signerId?: string,
    status?: string,
    documentId?: string,
    requestedBy?: string,
    tenantId?: string,
    page?: PageQueryDto,
  ) {
    const args = pageArgs(page);
    const rows = await this.findRequests({ signerId, status, documentId, requestedBy, tenantId }, prismaPage(args));
    return mapPage(finishPage(rows, args), (r) => ({ ...r, allowedMethodsNow: allowedMethodsForRequest(r) }));
  }

  /** Igual que `list` pero siempre array (tope 200); lo usa la bandeja (inbox). */
  listAll(signerId?: string, status?: string, documentId?: string, requestedBy?: string, tenantId?: string) {
    return this.findRequests({ signerId, status, documentId, requestedBy, tenantId }, prismaPage(pageArgs()));
  }

  private findRequests(
    f: { signerId?: string; status?: string; documentId?: string; requestedBy?: string; tenantId?: string },
    pg: { take: number; skip?: number; cursor?: { id: string } },
  ) {
    return this.prisma.signatureRequest.findMany({
      where: {
        tenantId: f.tenantId,
        documentId: f.documentId,
        requestedBy: f.requestedBy,
        status: f.status ? (f.status as never) : undefined,
        signers: f.signerId
          ? { some: { OR: [{ signerId: f.signerId }, { delegatedTo: f.signerId }] } }
          : undefined,
      },
      include: INCLUDE_SIGNERS,
      orderBy: STABLE_ORDER,
      ...pg,
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

  /** Estado de la solicitud + `allowedMethodsNow` (métodos usables hoy según el estado del PDF). */
  async getStatus(id: string, tenantId?: string) {
    const found = await this.getOrThrow(id, tenantId);
    return { ...found, allowedMethodsNow: allowedMethodsForRequest(found) };
  }

  /** Ejecuta un efecto post-commit sin que su fallo tumbe la respuesta; devuelve si tuvo éxito. */
  private async safe(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (error) {
      this.log.error(`${label} falló: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Fila de `Signer` sobre la que puede actuar `actorId`. `undefined` si no es
   * firmante; 403 si lo era pero delegó su firma (ya no puede actuar).
   */
  private resolveActor<T extends ActorSigner>(signers: T[], actorId: string): T | undefined {
    const signer = pickSigner(actingCandidates(signers, actorId));
    if (signer) return signer;
    if (signers.some((s) => s.signerId === actorId && s.delegatedTo)) {
      throw new ForbiddenException('Delegaste esta firma: ya no puedes actuar sobre ella');
    }
    return undefined;
  }

  private outcome(
    request: { status: RequestStatus; signers: { id: string; status: SignerStatus; signedAt: Date | null }[] },
    signerRowId: string,
  ): SignOutcome {
    const row = request.signers.find((s) => s.id === signerRowId);
    return {
      status: row?.status ?? 'PENDIENTE',
      signedAt: row?.signedAt ?? null,
      requestStatus: request.status,
    };
  }

  private async writeConsent(id: string, signerId: string, ip?: string, userAgent?: string) {
    const ipHash = createHash('sha256').update(ip ?? '0.0.0.0').digest('hex').slice(0, 32);
    const userAgentHash = userAgent
      ? createHash('sha256').update(userAgent).digest('hex').slice(0, 32)
      : null;
    // Idempotente: si ya aceptó la versión vigente se devuelve el registro
    // existente SIN reescribirlo (la prueba original de IP/UA/fecha no se pisa).
    // La unicidad [signatureRequestId, signerId, textVersion] del modelo cubre
    // la carrera de doble clic: el perdedor captura P2002 y relee el ganador.
    const key = {
      signatureRequestId_signerId_textVersion: {
        signatureRequestId: id,
        signerId,
        textVersion: CONSENT_VERSION,
      },
    };
    const existing = await this.prisma.consentAcceptance.findUnique({ where: key });
    if (existing) return existing;
    try {
      return await this.prisma.consentAcceptance.create({
        data: { signatureRequestId: id, signerId, textVersion: CONSENT_VERSION, ipHash, userAgentHash },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const winner = await this.prisma.consentAcceptance.findUnique({ where: key });
        if (winner) return winner;
      }
      throw e;
    }
  }

  /**
   * `tenantId` se omite SÓLO desde el portal público: ahí el enlace de un solo
   * uso ya identifica la solicitud. Desde sesión, el controller siempre lo pasa.
   */
  async recordConsent(
    id: string,
    body: { signerId: string; ip?: string; userAgent?: string },
    tenantId?: string,
  ) {
    const request = await this.getOrThrow(id, tenantId);
    if (!this.resolveActor(request.signers, body.signerId)) {
      throw new NotFoundException(`Firmante ${body.signerId} no está en la solicitud ${id}`);
    }
    return this.writeConsent(id, body.signerId, body.ip, body.userAgent);
  }

  /** Descarga de la copia firmada desde el portal público: queda en la cadena de auditoría. */
  async recordSignedCopyDownload(
    id: string,
    body: { signerId: string; ip?: string; userAgent?: string },
  ) {
    const request = await this.getOrThrow(id);
    await this.collab.audit({
      signatureRequestId: id,
      documentId: request.documentId,
      actorId: body.signerId,
      action: 'SIGNED_COPY_DOWNLOADED',
      payload: { ip: body.ip, userAgent: body.userAgent },
    });
  }

  /** Marca la solicitud EXPIRADA (si sigue abierta) y avisa al workflow. */
  private async expire(request: { id: string; documentId: string }) {
    const closed = await this.prisma.signatureRequest.updateMany({
      where: { id: request.id, status: { in: OPEN_REQUEST } },
      data: { status: 'EXPIRADA' },
    });
    if (closed.count === 0) return;
    await this.collab.audit({
      signatureRequestId: request.id,
      documentId: request.documentId,
      actorId: 'system',
      action: 'REQUEST_EXPIRED',
    });
    await this.safe('workflow.signalRejected(expire)', () =>
      this.workflow.signalRejected(request.id, 'system'),
    );
  }

  /**
   * Reintento idempotente: la solicitud ya está COMPLETADA pero el post-commit
   * (señal / evidencia) pudo haber fallado. Si no hay manifiesto, lo reintenta.
   */
  private async retryCompletion(request: { id: string }, signerId: string) {
    const manifest = await this.prisma.evidenceManifest.findUnique({
      where: { signatureRequestId: request.id },
      select: { id: true },
    });
    if (manifest) return;
    await this.safe('workflow.signalSigned(retry)', () =>
      this.workflow.signalSigned(request.id, signerId),
    );
    const ok = await this.safe('evidence.generateForRequest(retry)', () =>
      this.evidence.generateForRequest(request.id),
    );
    if (ok) await this.mail.sendCompleted(request.id).catch(() => undefined);
  }

  /**
   * Devuelve SÓLO {status, signedAt, requestStatus}: ni el PDF firmado ni datos
   * de otros firmantes. `tenantId` se omite únicamente desde el portal público.
   */
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
    tenantId?: string,
  ): Promise<SignOutcome> {
    const before = await this.getOrThrow(id, tenantId);
    const mine = this.resolveActor(before.signers, body.signerId);
    if (!mine) throw new NotFoundException(`Firmante ${body.signerId} no está en la solicitud ${id}`);

    // Reintento idempotente: nada que firmar, pero si la solicitud quedó
    // COMPLETADA sin evidencia, se reintenta el post-commit.
    if (CLOSED_REQUEST.includes(before.status) || mine.status === 'FIRMADO' || mine.status === 'RECHAZADO') {
      if (before.status === 'COMPLETADA') await this.retryCompletion(before, mine.signerId);
      return this.outcome(before, mine.id);
    }

    if (before.expiresAt && before.expiresAt.getTime() <= Date.now()) {
      await this.expire(before);
      throw new GoneException({ error: 'REQUEST_EXPIRED', message: 'La solicitud de firma expiró' });
    }

    if (body.consentAccepted) {
      await this.writeConsent(id, body.signerId, body.ip, body.userAgent);
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

    type Request = Awaited<ReturnType<SignatureRequestsService['getOrThrow']>>;
    type TxResult =
      | { kind: 'noop'; request: Request; signerRowId: string }
      | {
          kind: 'pending';
          request: Request;
          signerRowId: string;
          signed: import('../signing/signer-adapter').SignResult;
        }
      | {
          kind: 'signed';
          request: Request;
          signerRowId: string;
          signed: import('../signing/signer-adapter').SignResult;
          strokeObjectKey?: string;
          onBehalfOf?: string;
        };

    const result: TxResult = await this.prisma.$transaction(async (tx): Promise<TxResult> => {
      // Serializa las firmas del mismo documento: el PDF presentado se lee,
      // se firma y se reescribe, y no admite dos escritores a la vez.
      await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${before.documentId} FOR UPDATE`;

      const request = await tx.signatureRequest.findUnique({
        where: { id },
        include: { ...INCLUDE_SIGNERS, document: true },
      });
      if (!request) throw new NotFoundException(`Solicitud de firma ${id} no encontrada`);
      const noop = (signerRowId: string): TxResult => ({ kind: 'noop', request, signerRowId });

      if (CLOSED_REQUEST.includes(request.status)) return noop(mine.id);
      if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) {
        throw new GoneException({ error: 'REQUEST_EXPIRED', message: 'La solicitud de firma expiró' });
      }

      // El firmante actúa por sí mismo (si no delegó) o como delegado.
      const signer = this.resolveActor(request.signers, body.signerId);
      if (!signer) {
        throw new NotFoundException(`Firmante ${body.signerId} no está en la solicitud ${id}`);
      }
      if (signer.status === 'FIRMADO' || signer.status === 'RECHAZADO') return noop(signer.id);
      const onBehalfOf = signer.signerId !== body.signerId ? signer.signerId : undefined;
      const isReconcileRetry = signer.status === 'PENDIENTE' && Boolean(signer.pendingRef);
      if (isReconcileRetry) {
        // Ya hay una firma asíncrona en curso (2FA/biometría esperando al
        // proveedor). No se vuelve a reclamar ni a invocar al proveedor —
        // signature-reconcile.service la cierra cuando el proveedor responda.
        return noop(signer.id);
      }

      if (!request.methods.includes(body.method)) {
        throw new BadRequestException(
          `Método ${body.method} no autorizado para esta solicitud (permitidos: ${request.methods.join(', ')})`,
        );
      }

      // Falla temprano (antes de storage/adaptadores) si el PDF ya lleva firma
      // PAdES y el método estamparía visualmente: reescribirlo la invalidaría.
      const allowedNow = allowedMethodsForRequest(request);
      if (!allowedNow.includes(body.method)) {
        throw new ConflictException({
          error: 'METHOD_NOT_ALLOWED_AFTER_SIGNATURE',
          message:
            `El documento ya tiene firma digital: el método ${body.method} ya no se puede usar. ` +
            `Métodos permitidos ahora: ${allowedNow.join(', ') || 'ninguno'}.`,
          allowedMethods: allowedNow,
        });
      }

      // FREEZE obligatorio: sólo se firma sobre un canónico congelado.
      if (!request.document.locked) {
        throw new ConflictException({
          error: 'DOCUMENT_NOT_FROZEN',
          message: 'El documento no está congelado; no se puede firmar',
        });
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
          // La aserción se emite al actor (usuario o delegado), no al firmante original.
          signerId: body.signerId,
        });
      }

      if (request.kycPolicy && request.kycPolicy !== 'NONE') {
        const email = signer.email?.toLowerCase();
        // EVERY_SIGN exige que el alta se HABILITARA después de crear ESTA
        // solicitud (obliga a repetir la verificación); ONCE acepta cualquier
        // alta HABILITADO dentro de los últimos 90 días.
        const freshCutoff =
          request.kycPolicy === 'EVERY_SIGN' ? request.createdAt : new Date(Date.now() - KYC_ONCE_MAX_AGE_MS);
        const verified =
          email &&
          (await tx.onboardingCase.findFirst({
            where: {
              tenantId: request.tenantId,
              email: { equals: email, mode: 'insensitive' },
              status: 'HABILITADO',
              updatedAt: { gte: freshCutoff },
            },
            orderBy: { updatedAt: 'desc' },
          }));
        if (!verified) {
          throw new ForbiddenException(
            request.kycPolicy === 'EVERY_SIGN'
              ? 'Esta solicitud exige verificar identidad (INE + prueba de vida) después de haberse creado; pide a RH que repita el alta'
              : 'Esta solicitud exige una verificación de identidad vigente (últimos 90 días); pide a RH que complete el alta',
          );
        }
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
      if (claim.count === 0) return noop(signer.id);

      // Recuadro de firma: el del firmante en el orden (aunque hoy firme un
      // delegado), o cualquiera del documento.
      const field =
        (await tx.signatureField.findFirst({
          where: { documentId: request.documentId, signerId: signer.signerId, type: 'SIGNATURE' },
        })) ??
        (await tx.signatureField.findFirst({
          where: { documentId: request.documentId, type: 'SIGNATURE' },
        }));

      // Canónico: SIEMPRE se rehashea contra storage antes de aceptar la firma.
      // La ceremonia firma la copia presentada (o el canónico la primera vez)
      // y escribe el resultado en presented*, nunca encima de objectKey.
      const canonicalPdf = await this.storage.getObject(
        request.document.objectKey,
        request.document.enc as unknown as EncMeta,
      );
      const liveCanonical = createHash('sha256').update(canonicalPdf).digest('hex');
      if (liveCanonical !== request.document.hash) {
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
        return { kind: 'pending', request: stillPending, signerRowId: signer.id, signed };
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

      // allSigned se calcula DENTRO de la tx releyendo a TODOS los firmantes
      // tras el update (no con el snapshot del inicio).
      const signersNow = await tx.signer.findMany({ where: { signatureRequestId: id } });
      const allSigned = signersNow.every((s) => s.status === 'FIRMADO');

      const updated = await tx.signatureRequest.update({
        where: { id },
        data: { status: allSigned ? 'COMPLETADA' : 'EN_FIRMA' },
        include: INCLUDE_SIGNERS,
      });
      return { kind: 'signed', request: updated, signerRowId: signer.id, signed, strokeObjectKey, onBehalfOf };
    }, SIGN_TX_OPTIONS);

    const request = result.request;
    if (result.kind === 'noop') return this.outcome(request, result.signerRowId);

    // Fase B — firma asíncrona iniciada: audita y espera al reconciliador.
    if (result.kind === 'pending') {
      const sr = result.signed;
      await this.collab.audit({
        signatureRequestId: request.id,
        documentId: request.documentId,
        actorId: body.signerId,
        action: 'SIGNATURE_PENDING',
        payload: { method: body.method, provider: sr.provider, pendingRef: sr.pendingRef, detail: sr.detail },
      });
      if (request.requestedBy && request.requestedBy !== body.signerId) {
        await this.collab.notify(
          request.requestedBy,
          `${body.signerId} inició su firma`,
          `Firma ${body.method} en curso; falta la confirmación del proveedor.`,
          `/documents/${request.documentId}`,
          request.tenantId,
        );
      }
      return this.outcome(request, result.signerRowId);
    }

    const now = new Date().toISOString();
    const filledSigner = request.signers.find((s) => s.id === result.signerRowId);
    const onBehalfOf = result.onBehalfOf;
    const effectiveSignerId = onBehalfOf ?? body.signerId;
    const signerName =
      (onBehalfOf ? filledSigner?.delegatedToName : filledSigner?.name) ?? filledSigner?.name ?? undefined;
    this.realtime.notifyDocumentEvent(request.documentId, {
      type: 'SIGNATURE_APPLIED',
      actorId: body.signerId,
      actorName: signerName,
      at: now,
    });
    const sr = result.signed;

    // Fase B — sello de tiempo RFC 3161 POR EVENTO sobre el hash de esta firma
    // (además del sello del paquete). Best-effort: un fallo de la TSA no
    // bloquea la firma.
    let eventTimestamp: { provider: string; tokenHash: string; issuedAt: string } | undefined;
    if (sr.signatureHash && /^[0-9a-f]{64}$/i.test(sr.signatureHash)) {
      try {
        const ts = await requestTimestamp(Buffer.from(sr.signatureHash, 'hex'));
        if (ts) {
          const tokenHash = createHash('sha256').update(ts.token).digest('hex');
          const issuedAt = new Date(ts.info.genTime);
          await this.prisma.signatureEventTimestamp.upsert({
            where: { signatureRequestId_signerId: { signatureRequestId: request.id, signerId: effectiveSignerId } },
            create: {
              signatureRequestId: request.id,
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
      signatureRequestId: request.id,
      documentId: request.documentId,
      actorId: body.signerId,
      actorName: signerName,
      action: 'SIGNATURE_APPLIED',
      payload: {
        method: body.method,
        onBehalfOf,
        algorithm: sr.algorithm,
        provider: sr.provider,
        signatureHash: sr.signatureHash,
        certificate: sr.certificate,
        eventTimestamp,
        strokeObjectKey: result.strokeObjectKey,
      },
    });

    // La señal al workflow (que puede disparar el sellado) va DESPUÉS de que
    // el evento SIGNATURE_APPLIED con su sello por evento esté persistido. La
    // firma ya está commiteada: si la señal falla se registra y el reintento
    // del firmante (alreadySigned + COMPLETADA sin evidencia) la repite.
    await this.safe('workflow.signalSigned', () => this.workflow.signalSigned(request.id, effectiveSignerId));

    if (request.requestedBy && request.requestedBy !== body.signerId) {
      await this.collab.notify(
        request.requestedBy,
        `${signerName ?? body.signerId} firmó`,
        `Método ${body.method}. Estado: ${request.status}.`,
        `/documents/${request.documentId}`,
        request.tenantId,
      );
    }
    if (request.status === 'EN_FIRMA' && request.order === 'SECUENCIAL') {
      await this.notifyNextInSequence(request).catch(() => undefined);
    }
    if (request.status === 'COMPLETADA') {
      this.realtime.notifyDocumentEvent(request.documentId, {
        type: 'REQUEST_COMPLETED',
        actorId: body.signerId,
        actorName: signerName,
        at: now,
      });
      const ok = await this.safe('evidence.generateForRequest', () =>
        this.evidence.generateForRequest(request.id),
      );
      if (ok) await this.mail.sendCompleted(request.id).catch(() => undefined);
    }

    return this.outcome(request, result.signerRowId);
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
    if (!request || CLOSED_REQUEST.includes(request.status)) return;
    const signer = request.signers.find(
      (s) => (s.signerId === signerId || s.delegatedTo === signerId) && s.status === 'PENDIENTE' && s.pendingRef,
    );
    if (!signer) return;

    if (r.status === 'failed') {
      await this.prisma.$transaction(async (tx) => {
        await tx.signer.update({
          where: { id: signer.id },
          data: { status: 'RECHAZADO', pendingRef: null, pendingSince: null },
        });
        await tx.signatureRequest.updateMany({
          where: { id: signatureRequestId, status: { in: OPEN_REQUEST } },
          data: { status: 'RECHAZADA' },
        });
      });
      await this.safe('workflow.signalRejected(reconcile)', () =>
        this.workflow.signalRejected(signatureRequestId, signer.signerId),
      );
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
      await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${request.documentId} FOR UPDATE`;
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
      const signersNow = await tx.signer.findMany({ where: { signatureRequestId } });
      const allSigned = signersNow.every((s) => s.status === 'FIRMADO');
      return tx.signatureRequest.update({
        where: { id: signatureRequestId },
        data: { status: allSigned ? 'COMPLETADA' : 'EN_FIRMA' },
        include: INCLUDE_SIGNERS,
      });
    }, SIGN_TX_OPTIONS);

    await this.collab.audit({
      signatureRequestId,
      documentId: request.documentId,
      actorId: signer.signerId,
      actorName: signer.name ?? undefined,
      action: 'SIGNATURE_APPLIED',
      payload: { method: signer.usedMethod, signatureHash, reconciled: true },
    });
    await this.safe('workflow.signalSigned(reconcile)', () =>
      this.workflow.signalSigned(signatureRequestId, signer.signerId),
    );
    if (completed.status === 'COMPLETADA') {
      const ok = await this.safe('evidence.generateForRequest(reconcile)', () =>
        this.evidence.generateForRequest(signatureRequestId),
      );
      if (ok) await this.mail.sendCompleted(signatureRequestId).catch(() => undefined);
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

  /**
   * Rechazo por el propio firmante (o su delegado vigente). Sólo si su fila está
   * PENDIENTE/EN_PROCESO (nunca tras firmar) y, en orden SECUENCIAL, cuando ya
   * le toca el turno. El cambio de estado es atómico.
   */
  async reject(id: string, body: { signerId: string; reason?: string }, tenantId?: string) {
    const request = await this.getOrThrow(id, tenantId);
    if (CLOSED_REQUEST.includes(request.status)) return request;

    const candidates = actingCandidates(request.signers, body.signerId);
    if (candidates.length === 0) {
      throw new ForbiddenException(
        request.signers.some((s) => s.signerId === body.signerId && s.delegatedTo)
          ? 'Delegaste esta firma: ya no puedes actuar sobre ella'
          : 'No eres firmante de esta solicitud',
      );
    }
    const signer = pickSigner(candidates) as (typeof candidates)[number];
    if (!(OPEN_SIGNER as string[]).includes(signer.status)) {
      if (signer.status === 'FIRMADO') {
        throw new ConflictException('Ya firmaste esta solicitud: no puedes rechazarla');
      }
      return request; // ya RECHAZADO
    }
    if (request.order === 'SECUENCIAL') {
      const pendingBefore = request.signers.some(
        (s) => s.sortOrder < signer.sortOrder && (OPEN_SIGNER as string[]).includes(s.status),
      );
      if (pendingBefore) {
        throw new BadRequestException(
          'Todavía hay firmantes anteriores pendientes en el orden secuencial',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.signer.updateMany({
        where: { id: signer.id, status: { in: OPEN_SIGNER } },
        data: { status: 'RECHAZADO', pendingRef: null, pendingSince: null },
      });
      if (claimed.count === 0) {
        throw new ConflictException('La firma ya no está pendiente (se firmó o rechazó en paralelo)');
      }
      await tx.signatureRequest.updateMany({
        where: { id, tenantId, status: { in: OPEN_REQUEST } },
        data: { status: 'RECHAZADA' },
      });
      return tx.signatureRequest.findFirst({ where: { id, tenantId }, include: INCLUDE_SIGNERS });
    }, SIGN_TX_OPTIONS);
    if (!updated) throw new NotFoundException(`Solicitud de firma ${id} no encontrada`);

    await this.safe('workflow.signalRejected', () => this.workflow.signalRejected(id, body.signerId));
    await this.collab.audit({
      signatureRequestId: id,
      documentId: updated.documentId,
      actorId: body.signerId,
      action: 'REQUEST_REJECTED',
      payload: { reason: body.reason },
    });
    return updated;
  }

  /**
   * Cancela la solicitud (sólo emisor/admin, lo impone el controller). Cierra
   * también a los firmantes abiertos para no dejar PENDIENTE/EN_PROCESO huérfanos
   * (el reconciliador los seguiría consultando) y deja rastro de auditoría.
   */
  async cancel(id: string, body: { actorId?: string }, tenantId: string) {
    const request = await this.getOrThrow(id, tenantId);
    if (CLOSED_REQUEST.includes(request.status)) return request;
    const actor = body.actorId ?? request.requestedBy ?? 'system';

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.signer.updateMany({
        where: { signatureRequestId: id, status: { in: OPEN_SIGNER } },
        data: { status: 'RECHAZADO', pendingRef: null, pendingSince: null },
      });
      await tx.signatureRequest.updateMany({
        where: { id, tenantId, status: { in: OPEN_REQUEST } },
        data: { status: 'RECHAZADA' },
      });
      return tx.signatureRequest.findFirst({ where: { id, tenantId }, include: INCLUDE_SIGNERS });
    }, SIGN_TX_OPTIONS);
    if (!updated) throw new NotFoundException(`Solicitud de firma ${id} no encontrada`);

    await this.collab.audit({
      signatureRequestId: id,
      documentId: updated.documentId,
      actorId: actor,
      action: 'REQUEST_CANCELLED',
      payload: {
        previousStatus: request.status,
        cancelledSigners: request.signers
          .filter((s) => (OPEN_SIGNER as string[]).includes(s.status))
          .map((s) => s.signerId),
      },
    });
    await this.safe('workflow.cancelRun', () => this.workflow.cancelRun(id));
    await this.safe('workflow.signalRejected(cancel)', () => this.workflow.signalRejected(id, actor));
    return updated;
  }

  /**
   * Delegación: el destinatario debe ser miembro ACTIVO del mismo tenant (se
   * canoniza a su `userId`). Tras delegar, el firmante original ya no puede
   * firmar ni rechazar esa fila: sólo el delegado.
   */
  async delegate(
    id: string,
    body: { fromSignerId: string; toSignerId: string; toName?: string; reason?: string; auto?: boolean },
    tenantId: string,
  ) {
    const request = await this.getOrThrow(id, tenantId);
    if (CLOSED_REQUEST.includes(request.status)) {
      throw new ConflictException('La solicitud ya está cerrada');
    }
    const signer = this.resolveActor(request.signers, body.fromSignerId);
    if (!signer) throw new NotFoundException('Firmante no encontrado');
    if (signer.status !== 'PENDIENTE') {
      throw new BadRequestException('Solo se puede delegar una firma pendiente');
    }
    if (body.toSignerId === body.fromSignerId) {
      throw new BadRequestException('No puedes delegarte una firma a ti mismo');
    }
    const member = await this.prisma.tenantMembership.findFirst({
      where: {
        tenant: { OR: [{ id: tenantId }, { slug: tenantId }] },
        active: true,
        OR: [{ userId: body.toSignerId }, { email: { equals: body.toSignerId, mode: 'insensitive' } }],
      },
      select: { userId: true, name: true },
    });
    if (!member) {
      throw new BadRequestException('El destinatario no es un miembro activo de tu organización');
    }
    const toSignerId = member.userId;
    if (toSignerId === body.fromSignerId || toSignerId === signer.signerId) {
      throw new BadRequestException('No puedes delegarte una firma a ti mismo');
    }
    const toName = body.toName ?? member.name ?? undefined;

    const claimed = await this.prisma.signer.updateMany({
      where: { id: signer.id, status: 'PENDIENTE' },
      data: { delegatedTo: toSignerId, delegatedToName: toName },
    });
    if (claimed.count === 0) {
      throw new ConflictException('La firma ya no está pendiente');
    }
    // Las tareas humanas abiertas pasan a la bandeja del delegado.
    await this.workflow.reassignForDelegation(id, body.fromSignerId, toSignerId);
    await this.collab.audit({
      signatureRequestId: id,
      documentId: request.documentId,
      actorId: body.auto ? 'system' : body.fromSignerId,
      action: 'DELEGATED',
      payload: {
        fromSignerId: body.fromSignerId,
        toSignerId,
        toName,
        reason: body.reason,
        auto: Boolean(body.auto),
      },
    });
    await this.collab.notify(
      toSignerId,
      'Te delegaron una firma',
      `${signer.name ?? body.fromSignerId} te delegó un documento.`,
      `/documents/${request.documentId}`,
      request.tenantId,
    );
    return this.getOrThrow(id, tenantId);
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
    tenantId?: string,
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
        tenantId,
      );
    }
  }
}
