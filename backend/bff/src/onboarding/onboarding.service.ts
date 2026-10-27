import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import type { OnboardingCase, OnboardingKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runAsSystem } from '../prisma/tenant-guard';
import { STABLE_ORDER, finishPage, mapPage, pageArgs, prismaPage, type PageQueryDto } from '../common/pagination';
import { CollaborationService } from '../collaboration/collaboration.service';
import { SigningRouter } from '../signing/signing.router';
import { StorageService, assertTenantKey } from '../storage/storage.service';
import type { EncMeta } from '../storage/object-crypto';
import { WebhooksService } from '../webhooks/webhooks.service';
import { cloudEvent, EVENT_TYPES } from '../webhooks/cloud-events';
import { baseSignerId, decideEnableMode, uniqueSignerId } from './enable-policy';
import { BIOMETRIC_CONSENT_TEXT, BIOMETRIC_CONSENT_VERSION, biometricConsentHash } from './biometric-consent';
import { OcrService } from '../identity/ocr.service';
import { IDENTITY_VERIFIER, type IdentityVerifier } from '../identity/identity-verifier';
import { BIOMETRIC_ENGINE, type BiometricEngine } from '../identity/biometric-engine';
import { AccountConflictError, KeycloakAdminService } from './keycloak-admin.service';
import { pickUsername, splitNames, type PersonNames } from './username';

/** Referencia a un objeto cifrado en storage (lo que se guarda en las columnas Json). */
interface StoredRef {
  key: string;
  sha256: string;
  size: number;
  enc: EncMeta;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** La captura de INE o de biometría no empieza sin la aceptación escrita del titular. */
export function assertBiometricConsent(row: { biometricConsentAt: Date | null }): void {
  if (!row.biometricConsentAt) {
    throw new BadRequestException(
      'Falta el consentimiento expreso y por escrito del titular para tratar su biometría y su INE (LFPDPPP).',
    );
  }
}

/** Oculta las referencias de storage y el id de la cuenta, y expone banderas `has*`. */
function publicView(row: OnboardingCase) {
  const { ineFront, ineBack, selfie, accountId: _accountId, ...rest } = row;
  return {
    ...rest,
    hasIneFront: ineFront != null,
    hasIneBack: ineBack != null,
    hasSelfie: selfie != null,
  };
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collab: CollaborationService,
    private readonly signing: SigningRouter,
    private readonly storage: StorageService,
    private readonly webhooks: WebhooksService,
    private readonly ocr: OcrService,
    @Inject(IDENTITY_VERIFIER) private readonly identity: IdentityVerifier,
    @Inject(BIOMETRIC_ENGINE) private readonly biometrics: BiometricEngine,
    @Optional() private readonly accounts?: KeycloakAdminService,
  ) {}

  private readonly log = new Logger(OnboardingService.name);

  /**
   * Usuario de acceso de la persona dada de alta. Es único contra otras altas y contra Keycloak; si
   * la creación de cuentas está configurada también crea la cuenta (contraseña temporal) y devuelve
   * su id. Sin configurar, solo reserva el nombre de usuario.
   */
  private async provisionAccount(
    body: PersonNames & { tenantId: string; email: string },
  ): Promise<{ username: string; accountId: string | null }> {
    const lost = new Set<string>(); // perdió la carrera en Keycloak entre la consulta y el alta
    const isTaken = async (username: string): Promise<boolean> => {
      if (lost.has(username)) return true;
      // El usuario es único en todo el realm de Keycloak, no por tenant: la consulta es global a propósito.
      const inOnboarding = await runAsSystem('Onboarding: el usuario de acceso es único en todo el realm', () =>
        this.prisma.onboardingCase.count({ where: { username: { equals: username, mode: 'insensitive' } } }),
      );
      if (inOnboarding > 0) return true;
      return this.accounts?.enabled ? this.accounts.usernameExists(username) : false;
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const username = await pickUsername(body, isTaken);
      if (!this.accounts?.enabled) return { username, accountId: null };
      const { given, surnames } = splitNames(body);
      const display = {
        firstName: (body.givenNames?.trim() || body.fullName.trim().split(/\s+/).slice(0, Math.max(given.length, 1)).join(' ')),
        lastName: [body.lastName, body.secondLastName].filter(Boolean).join(' ').trim() || surnames.join(' '),
      };
      try {
        const { id } = await this.accounts.createUser({
          username,
          email: body.email,
          firstName: display.firstName,
          lastName: display.lastName,
          tenant: body.tenantId,
        });
        return { username, accountId: id };
      } catch (error) {
        if (error instanceof AccountConflictError && error.field === 'username') {
          lost.add(username);
          continue;
        }
        if (error instanceof AccountConflictError) {
          throw new ConflictException({ error: 'ACCOUNT_EMAIL_EXISTS', message: 'Ya existe una cuenta con ese correo' });
        }
        throw error;
      }
    }
    throw new ConflictException({ error: 'USERNAME_UNAVAILABLE', message: 'No se pudo reservar un usuario para este nombre' });
  }

  async list(tenantId: string, page?: PageQueryDto) {
    const args = pageArgs(page);
    const rows = await this.prisma.onboardingCase.findMany({
      where: { tenantId },
      orderBy: STABLE_ORDER,
      ...prismaPage(args),
    });
    return mapPage(finishPage(rows, args), publicView);
  }

  async get(id: string, tenantId: string) {
    return publicView(await this.load(id, tenantId));
  }

  consentNotice() {
    return { version: BIOMETRIC_CONSENT_VERSION, text: BIOMETRIC_CONSENT_TEXT };
  }

  async create(body: {
    tenantId: string;
    kind?: OnboardingKind;
    fullName: string;
    givenNames?: string;
    lastName?: string;
    secondLastName?: string;
    email: string;
    curp?: string;
    rfc?: string;
    requestedBy: string;
    requestedByName?: string;
    biometricConsent: boolean;
    ip?: string;
    userAgent?: string;
  }) {
    if (!body.tenantId) throw new BadRequestException('Falta el tenant del alta');
    if (!body.fullName?.trim() || !body.email?.trim()) {
      throw new BadRequestException('Nombre y correo son obligatorios');
    }
    if (body.biometricConsent !== true) {
      throw new BadRequestException(
        'Se requiere el consentimiento expreso y por escrito del titular para tratar datos biométricos (LFPDPPP).',
      );
    }
    const now = new Date();
    const email = body.email.trim().toLowerCase();
    const account = await this.provisionAccount({ ...body, email });
    let created: OnboardingCase;
    try {
      created = await this.createCase(body, email, account, now);
    } catch (error) {
      // El alta no se guardó: la cuenta recién creada no puede quedar suelta con acceso.
      if (account.accountId) await this.accounts?.deleteUser(account.accountId).catch(() => undefined);
      throw error;
    }
    if (account.accountId) {
      await this.collab.audit({
        onboardingId: created.id,
        actorId: body.requestedBy,
        actorName: body.requestedByName,
        action: 'ACCOUNT_CREATED',
        payload: { username: account.username, passwordTemporary: true },
      });
    }
    await this.collab.audit({
      onboardingId: created.id,
      actorId: body.requestedBy,
      actorName: body.requestedByName,
      action: 'BIOMETRIC_CONSENT_ACCEPTED',
      payload: {
        version: BIOMETRIC_CONSENT_VERSION,
        textHash: biometricConsentHash(),
        text: BIOMETRIC_CONSENT_TEXT,
      },
    });
    await this.collab.audit({
      onboardingId: created.id,
      actorId: body.requestedBy,
      actorName: body.requestedByName,
      action: 'ONBOARDING_CREATED',
      payload: { kind: created.kind, email: created.email, username: account.username },
    });
    return publicView(created);
  }

  private createCase(
    body: Parameters<OnboardingService['create']>[0],
    email: string,
    account: { username: string; accountId: string | null },
    now: Date,
  ) {
    return this.prisma.onboardingCase.create({
      data: {
        tenantId: body.tenantId,
        kind: body.kind ?? 'EMPLEADO',
        status: 'DATOS',
        fullName: body.fullName.trim(),
        email,
        username: account.username,
        accountId: account.accountId,
        curp: body.curp?.trim().toUpperCase(),
        rfc: body.rfc?.trim().toUpperCase(),
        requestedBy: body.requestedBy,
        requestedByName: body.requestedByName,
        biometricConsentAt: now,
        biometricConsentVersion: BIOMETRIC_CONSENT_VERSION,
        biometricConsentTextHash: biometricConsentHash(),
        biometricConsentIp: body.ip,
        biometricConsentUserAgent: body.userAgent,
        biometricConsentActorId: body.requestedBy,
      },
    });
  }

  /**
   * Altas anteriores a este requisito: el titular acepta en el expediente
   * antes de que se permita la INE o la cámara. La primera aceptación no se
   * reescribe.
   */
  async recordBiometricConsent(
    id: string,
    body: { tenantId: string; actorId: string; actorName?: string; ip?: string; userAgent?: string },
  ) {
    const current = await this.load(id, body.tenantId);
    if (current.biometricConsentAt) return publicView(current);
    const updated = await this.prisma.onboardingCase.update({
      where: { id, tenantId: body.tenantId },
      data: {
        biometricConsentAt: new Date(),
        biometricConsentVersion: BIOMETRIC_CONSENT_VERSION,
        biometricConsentTextHash: biometricConsentHash(),
        biometricConsentIp: body.ip,
        biometricConsentUserAgent: body.userAgent,
        biometricConsentActorId: body.actorId,
      },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'BIOMETRIC_CONSENT_ACCEPTED',
      payload: {
        version: BIOMETRIC_CONSENT_VERSION,
        textHash: biometricConsentHash(),
        text: BIOMETRIC_CONSENT_TEXT,
      },
    });
    return publicView(updated);
  }

  private async load(id: string, tenantId: string) {
    const found = await this.prisma.onboardingCase.findFirst({ where: { id, tenantId } });
    if (!found) throw new NotFoundException(`Onboarding ${id} no encontrado`);
    return found;
  }

  private async store(prefix: string, filename: string, bytes: Buffer, contentType: string, tenantId: string): Promise<StoredRef> {
    const s = await this.storage.putObject({ prefix, filename, bytes, contentType, tenantId });
    return { key: s.objectKey, sha256: s.sha256, size: s.sizeBytes, enc: s.enc };
  }

  /**
   * `ref.key` se guarda COMPLETA en la fila (también las claves antiguas
   * `onboarding/ine/...`), así que la lectura no depende del formato nuevo;
   * `assertTenantKey` acepta ambos y rechaza claves de otro tenant.
   */
  private readRef(ref: StoredRef, tenantId: string): Promise<Buffer> {
    assertTenantKey(tenantId, ref.key);
    return this.storage.getObject(ref.key, ref.enc, tenantId);
  }

  async attachIne(
    id: string,
    body: { front?: Buffer; back?: Buffer; actorId: string; actorName?: string; tenantId: string },
  ) {
    const current = await this.load(id, body.tenantId);
    assertBiometricConsent(current);
    if (['HABILITADO', 'RECHAZADO'].includes(current.status)) {
      throw new BadRequestException('Este alta ya está cerrada');
    }
    if (!body.front?.length && !body.back?.length) {
      throw new BadRequestException('Adjunta el frente o el reverso de la INE');
    }

    const ineFront: StoredRef | null = body.front?.length
      ? await this.store(`onboarding/${body.tenantId}/ine`, `${id}-frente.jpg`, body.front, 'image/jpeg', body.tenantId)
      : (current.ineFront as unknown as StoredRef | null);
    const ineBack: StoredRef | null = body.back?.length
      ? await this.store(`onboarding/${body.tenantId}/ine`, `${id}-reverso.jpg`, body.back, 'image/jpeg', body.tenantId)
      : (current.ineBack as unknown as StoredRef | null);

    // ineHash: SHA-256 del conjunto ordenado de hashes de frente+reverso presentes.
    const parts = [ineFront?.sha256, ineBack?.sha256].filter(Boolean) as string[];
    const ineHash = parts.length ? sha256(Buffer.from(parts.join(':'))) : current.ineHash;

    // M16 — OCR/MRZ real cuando ya hay frente y reverso.
    let ineOcr: unknown = current.ineOcr;
    if (ineFront && ineBack) {
      try {
        const frontBytes = body.front?.length ? body.front : await this.readRef(ineFront, body.tenantId);
        const backBytes = body.back?.length ? body.back : await this.readRef(ineBack, body.tenantId);
        ineOcr = await this.ocr.recognizeIne({ front: frontBytes, back: backBytes });
      } catch (error) {
        ineOcr = { engine: 'tesseract.js', error: (error as Error).message };
      }
    }

    const updated = await this.prisma.onboardingCase.update({
      where: { id, tenantId: body.tenantId },
      data: {
        ineFront: ineFront as unknown as object,
        ineBack: ineBack as unknown as object,
        ineHash,
        ineOcr: ineOcr as object,
        status: ineFront && ineBack ? 'INE' : current.status,
      },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'INE_CAPTURED',
      payload: {
        ineHash,
        hasFront: Boolean(ineFront),
        hasBack: Boolean(ineBack),
        // Sin PII: sólo los NOMBRES de los campos que el OCR extrajo, nunca sus valores
        // (CURP, clave de elector, etc.).
        ocrFieldNames: Object.keys(
          ((ineOcr as { fields?: Record<string, unknown> })?.fields ?? {}) as Record<string, unknown>,
        ),
      },
    });
    return publicView(updated);
  }

  async captureLiveness(
    id: string,
    body: { selfie: Buffer; actorId: string; actorName?: string; tenantId: string },
  ) {
    const current = await this.load(id, body.tenantId);
    assertBiometricConsent(current);
    if (!body.selfie?.length) throw new BadRequestException('Se requiere una captura de prueba de vida');
    if (body.selfie.length < 2_000) throw new BadRequestException('La captura es demasiado pequeña');

    const selfie = await this.store(`onboarding/${body.tenantId}/selfie`, `${id}-selfie.jpg`, body.selfie, 'image/jpeg', body.tenantId);
    const livenessHash = selfie.sha256;

    // M16 — puerto BiometricEngine (noop|local face-api|remote). Nunca lanza:
    // un fallo del motor deja el alta en revisión manual, no la rechaza.
    let bio;
    try {
      const inePortrait = current.ineFront
        ? await this.readRef(current.ineFront as unknown as StoredRef, body.tenantId).catch(() => undefined)
        : undefined;
      bio = await this.biometrics.analyze({ onboardingId: id, selfie: body.selfie, inePortrait });
    } catch (error) {
      bio = {
        engine: this.biometrics.kind,
        livenessOk: false,
        livenessScore: null,
        faceMatchOk: false,
        faceMatchScore: null,
        sessionId: null,
        reasons: [(error as Error).message],
      };
    }

    const readyForReview = Boolean(current.ineFront && current.ineBack);
    const updated = await this.prisma.onboardingCase.update({
      where: { id, tenantId: body.tenantId },
      data: {
        selfie: selfie as unknown as object,
        livenessHash,
        livenessScore: bio.livenessScore,
        livenessOk: bio.livenessOk,
        faceMatchOk: bio.faceMatchOk,
        faceMatchScore: bio.faceMatchScore,
        biometricEngine: bio.engine,
        biometricSessionId: bio.sessionId,
        status: readyForReview ? 'EN_REVISION' : 'PRUEBA_VIDA',
      },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'LIVENESS_CAPTURED',
      payload: {
        livenessHash,
        engine: bio.engine,
        livenessOk: bio.livenessOk,
        faceMatchOk: bio.faceMatchOk,
        faceMatchScore: bio.faceMatchScore,
        reasons: bio.reasons,
      },
    });
    if (readyForReview) {
      await this.collab.notify(
        current.requestedBy,
        'Onboarding en revisión',
        `${current.fullName} ya tiene INE y prueba de vida. Falta habilitar la firma.`,
        `/onboarding/${id}`,
        current.tenantId,
      );
    }
    return publicView(updated);
  }

  async verifyIne(
    id: string,
    body: { actorId: string; actorName?: string; notes?: string; approve?: boolean; tenantId: string },
  ) {
    const current = await this.load(id, body.tenantId);
    assertBiometricConsent(current);
    if (!current.ineFront || !current.ineBack) {
      throw new BadRequestException('Faltan frente y reverso de la INE');
    }

    // M16 — verificación asistida: OCR + puerto IdentityVerifier (heuristic|renapo).
    let ineCheck: unknown = null;
    try {
      ineCheck = await this.identity.verify({
        declaredCurp: current.curp,
        declaredName: current.fullName,
        ocr: (current.ineOcr as never) ?? null,
      });
    } catch (error) {
      ineCheck = { kind: 'error', ok: false, reasons: [(error as Error).message] };
    }
    const check = ineCheck as { ok?: boolean } | null;

    // `manual` (por defecto): RH confirma; `body.approve === false` NO verifica.
    // Con IDENTITY_AUTOVERIFY=true se verifica solo si el puerto dice `ok`.
    const auto = process.env.IDENTITY_AUTOVERIFY === 'true';
    const verified = body.approve === false ? false : auto ? Boolean(check?.ok) : true;

    const updated = await this.prisma.onboardingCase.update({
      where: { id, tenantId: body.tenantId },
      data: {
        ineVerified: verified,
        ineCheck: ineCheck as object,
        notes: body.notes ?? current.notes,
        status: verified ? (current.selfie ? 'EN_REVISION' : 'INE') : current.status,
      },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: auto ? 'system' : body.actorId,
      actorName: body.actorName,
      action: verified ? 'INE_VERIFIED' : 'INE_CHECK_FAILED',
      payload: { auto, check: ineCheck },
    });
    return publicView(updated);
  }

  async enable(
    id: string,
    body: { actorId: string; actorName?: string; tenantId: string; override?: boolean; notes?: string },
  ) {
    const current = await this.load(id, body.tenantId);
    assertBiometricConsent(current);
    if (!current.ineVerified) {
      throw new BadRequestException('RH debe verificar la INE antes de habilitar la firma');
    }
    if (!current.selfie) {
      throw new BadRequestException('Falta la prueba de vida');
    }
    // No se marca livenessOk por decreto: el modo de revisión queda explícito y auditado.
    const reviewMode = decideEnableMode(current, { override: body.override, notes: body.notes });
    const signerId = await uniqueSignerId(
      baseSignerId(current.email, current.id),
      current.email,
      current.id,
      async (candidate, email) =>
        (await this.prisma.onboardingCase.count({
          where: {
            tenantId: current.tenantId,
            enabledSignerId: candidate,
            status: 'HABILITADO',
            NOT: { email: { equals: email, mode: 'insensitive' } },
          },
        })) > 0,
    );
    const updated = await this.prisma.onboardingCase.update({
      where: { id, tenantId: body.tenantId },
      data: { status: 'HABILITADO', enabledSignerId: signerId },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'SIGNER_ENABLED',
      payload: {
        enabledSignerId: signerId,
        reviewMode,
        engine: current.biometricEngine ?? 'noop',
        livenessOk: current.livenessOk,
        faceMatchOk: current.faceMatchOk,
        ...(reviewMode === 'manual-override' ? { overrideNotes: (body.notes ?? '').trim().slice(0, 500) } : {}),
      },
    });
    await this.collab.notify(
      signerId,
      'Identidad habilitada',
      'Ya puedes firmar documentos en Prestige.',
      '/inbox',
      current.tenantId,
    );
    await this.webhooks
      .emit(
        cloudEvent({
          type: EVENT_TYPES.onboardingEnabled,
          tenantId: updated.tenantId,
          subject: updated.id,
          data: {
            onboardingId: updated.id,
            enabledSignerId: signerId,
            kind: updated.kind,
            email: updated.email,
          },
        }),
      )
      .catch(() => undefined);
    return publicView(updated);
  }

  async reject(id: string, body: { actorId: string; actorName?: string; notes?: string; tenantId: string }) {
    const current = await this.load(id, body.tenantId);
    const updated = await this.prisma.onboardingCase.update({
      where: { id, tenantId: body.tenantId },
      data: { status: 'RECHAZADO', notes: body.notes ?? current.notes },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'ONBOARDING_REJECTED',
      payload: { notes: body.notes },
    });
    if (updated.accountId && this.accounts?.enabled) {
      // Un alta rechazada no debe dejar un acceso vivo. Se deshabilita (no se borra) y queda auditado;
      // si Keycloak no responde, el rechazo ya está guardado y se avisa en el log para repetirlo.
      await this.accounts
        .disableUser(updated.accountId)
        .then(() =>
          this.collab.audit({
            onboardingId: id,
            actorId: body.actorId,
            actorName: body.actorName,
            action: 'ACCOUNT_DISABLED',
            payload: { username: updated.username },
          }),
        )
        .catch((error: unknown) =>
          this.log.warn(`Alta ${id} rechazada, pero no se pudo deshabilitar la cuenta ${updated.username}: ${String(error)}`),
        );
    }
    return publicView(updated);
  }
}
