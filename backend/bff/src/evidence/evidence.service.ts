import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Prisma, type EvidenceManifest, type Signer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { EncMeta } from '../storage/object-crypto';
import { ManifestSigner } from './manifest-signer';
import { requestTimestamp, verifyTimestampToken } from '../signing/tsa/rfc3161';
import { WebhooksService } from '../webhooks/webhooks.service';
import { cloudEvent, EVENT_TYPES } from '../webhooks/cloud-events';
import { AuditChainService } from '../collaboration/audit-chain.service';

export interface EvidenceDossier {
  manifestId: string;
  files: { path: string; content: Buffer | string }[];
}

export type { EvidenceManifest };

export interface EvidenceVerificationResult {
  valid: boolean;
  mismatches: string[];
  /** Detalle por comprobación (para el verificador y la UI). */
  checks: {
    documentHash: boolean;
    signedHash: boolean;
    packageHash: boolean;
    chainOfCustody: boolean;
    manifestSignature: boolean | 'sin-firma';
    timestamp: boolean | 'sin-sello';
    /** M11 — cadena de auditoría inmutable del proceso (scoped a la solicitud). */
    auditChain: boolean;
    /** Fase B — sellos RFC 3161 por evento de firma. */
    eventTimestamps: boolean | 'sin-sellos';
  };
}

interface ChainEvent {
  action: string;
  actorId: string;
  at: string;
  hashAfter: string;
}

interface SignatureEntry {
  signerId: string;
  email?: string;
  method?: string;
  algorithm: string;
  provider?: string;
  certificate?: Record<string, unknown>;
  signatureHash: string;
  signedAt: string;
  /** Fase B — sello RFC 3161 de este evento de firma (si la TSA respondió). */
  eventTimestamp?: { provider: string; tokenHash: string; issuedAt: string };
}

const INCLUDE_FOR_MANIFEST = {
  signers: true,
  document: { include: { case: true } },
} as const;

/**
 * Feature: evidencia y verificación criptográfica del expediente de firma.
 * Formaliza el prototipo `seguriflow-preservation-demo` (docs/evidencia_bpn.json)
 * sobre el modelo Prisma `EvidenceManifest`.
 *
 * Todos los hashes se derivan de datos reales ya persistidos (contenido del
 * documento, firmantes y sus timestamps) — nada se inventa ni se hardcodea.
 * `verify()` vuelve a calcular la cadena completa contra lo almacenado y
 * reporta discrepancias reales, campo por campo.
 */
@Injectable()
export class EvidenceService {
  private readonly log = new Logger(EvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly manifestSigner: ManifestSigner,
    private readonly storage: StorageService,
    private readonly webhooks: WebhooksService,
    private readonly auditChain: AuditChainService,
  ) {}

  async generateForRequest(signatureRequestId: string): Promise<EvidenceManifest> {
    const existing = await this.prisma.evidenceManifest.findUnique({
      where: { signatureRequestId },
    });
    if (existing) return existing; // idempotente: no regenerar si ya existe

    const request = await this.prisma.signatureRequest.findUnique({
      where: { id: signatureRequestId },
      include: INCLUDE_FOR_MANIFEST,
    });
    if (!request) {
      throw new NotFoundException(`Solicitud de firma ${signatureRequestId} no encontrada`);
    }
    if (request.status !== 'COMPLETADA') {
      throw new BadRequestException(
        'Solo se puede generar evidencia para una solicitud COMPLETADA',
      );
    }

    const document = request.document;
    const signedSigners = request.signers
      .filter((s): s is Signer & { signedAt: Date } => s.status === 'FIRMADO' && s.signedAt !== null)
      .sort((a, b) => a.signedAt.getTime() - b.signedAt.getTime());

    const manifestId = randomBytes(8).toString('hex');

    // originalHash / presentedHash: en este MVP el documento presentado a
    // firma es el mismo que el original, así que ambos usan el hash SHA-256
    // real ya calculado y almacenado sobre el contenido del documento.
    const originalHash = document.hash;
    const presentedHash = document.hash;

    // signedHash: hash determinista sobre la lista ordenada (por signerId)
    // de {signerId, signedAt, usedMethod} de todos los firmantes.
    const signedHash = this.hashSignedSet(signedSigners);

    // packageHash: amarra manifestId + signedHash + documentId.
    const packageHash = createHash('sha256')
      .update(`${manifestId}${signedHash}${document.id}`)
      .digest('hex');

    // chainOfCustody: cadena de hashes real — cada evento encadena el hash
    // del evento anterior (genesis = originalHash del documento).
    let previousHash = originalHash;
    const chainOfCustody: ChainEvent[] = [];
    for (const signer of signedSigners) {
      const at = signer.signedAt.toISOString();
      const eventData = JSON.stringify({
        action: 'SIGNATURE_APPLIED',
        actorId: signer.signerId,
        at,
        method: signer.usedMethod,
      });
      const hashAfter = createHash('sha256').update(previousHash + eventData).digest('hex');
      chainOfCustody.push({ action: 'SIGNATURE_APPLIED', actorId: signer.signerId, at, hashAfter });
      previousHash = hashAfter;
    }

    // Metadatos de firma reales (algoritmo, proveedor, certificado) tomados de
    // la auditoría de cada evento SIGNATURE_APPLIED.
    const auditBySigner = new Map<string, Record<string, unknown>>();
    for (const ev of await this.prisma.processAuditEvent.findMany({
      where: { signatureRequestId: request.id, action: 'SIGNATURE_APPLIED' },
    })) {
      auditBySigner.set(ev.actorId, (ev.payload as Record<string, unknown>) ?? {});
    }
    const signatures: SignatureEntry[] = signedSigners.map((signer) => {
      const meta = auditBySigner.get(signer.signerId) ?? {};
      return {
        signerId: signer.signerId,
        email: signer.email ?? undefined,
        method: signer.usedMethod ?? undefined,
        algorithm: (meta.algorithm as string) ?? 'SHA-256',
        provider: (meta.provider as string) ?? undefined,
        certificate: (meta.certificate as Record<string, unknown>) ?? undefined,
        signatureHash:
          (meta.signatureHash as string) ??
          createHash('sha256')
            .update(`${signer.signerId}${signer.signedAt.toISOString()}${signer.usedMethod}`)
            .digest('hex'),
        signedAt: signer.signedAt.toISOString(),
        eventTimestamp: (meta.eventTimestamp as SignatureEntry['eventTimestamp']) ?? undefined,
      };
    });

    const consentRecords = (
      await this.prisma.consentAcceptance.findMany({ where: { signatureRequestId: request.id } })
    ).map((c) => ({
      id: c.id,
      signerId: c.signerId,
      acceptedAt: c.acceptedAt.toISOString(),
      ipHash: c.ipHash,
      textVersion: c.textVersion,
    }));

    // Sello de tiempo RFC 3161 real sobre packageHash (si TSA_URL está configurada).
    let tsa: Awaited<ReturnType<typeof requestTimestamp>> = null;
    try {
      tsa = await requestTimestamp(Buffer.from(packageHash, 'hex'));
    } catch (error) {
      this.log.warn(`TSA no disponible, el manifiesto se sella sin RFC 3161: ${(error as Error).message}`);
    }
    const timestampIssuedAt = tsa ? new Date(tsa.info.genTime) : new Date();
    const timestampProvider = tsa ? tsa.tsaUrl : 'sin-tsa';
    const timestampToken = tsa ? tsa.token.toString('base64') : null;
    const timestampTokenHash = tsa
      ? createHash('sha256').update(tsa.token).digest('hex')
      : createHash('sha256').update(`${packageHash}${timestampIssuedAt.toISOString()}`).digest('hex');

    // Cuerpo canónico del manifiesto: es lo que se firma y lo que el
    // verificador offline recompone.
    // M10 — política de firma pinada en la solicitud (si la hay, va DENTRO del
    // cuerpo firmado; si no, se omite para no cambiar el hash de manifiestos previos).
    const pinnedPolicy = request.policySnapshot ?? null;

    const manifestBody = {
      manifestId,
      signatureRequestId: request.id,
      documentId: document.id,
      documentVersion: document.version,
      tenantId: document.case.tenantId,
      signingOrder: request.order,
      originalHash,
      presentedHash,
      signedHash,
      packageHash,
      chainOfCustody,
      signatures,
      consentRecords,
      timestamp: {
        provider: timestampProvider,
        issuedAt: timestampIssuedAt.toISOString(),
        tokenHash: timestampTokenHash,
      },
      ...(pinnedPolicy ? { signaturePolicy: pinnedPolicy } : {}),
    };
    const signedManifest = this.manifestSigner.sign(manifestBody);

    let manifest: EvidenceManifest;
    try {
      manifest = await this.prisma.evidenceManifest.create({
        data: {
          signatureRequestId: request.id,
          manifestId,
          documentId: document.id,
          documentVersion: document.version,
          tenantId: document.case.tenantId,
          originalHash,
          presentedHash,
          signedHash,
          packageHash,
          signingOrder: request.order,
          chainOfCustody: chainOfCustody as unknown as object,
          consentRecords: consentRecords as unknown as object,
          signatures: signatures as unknown as object,
          timestampProvider,
          timestampIssuedAt,
          timestampTokenHash,
          timestampToken,
          manifestHash: signedManifest.manifestHash,
          manifestSignature: signedManifest.signature,
          manifestSigningKeyId: signedManifest.keyId,
          signaturePolicy: pinnedPolicy === null ? undefined : (pinnedPolicy as object),
          validationConclusion: 'VALID',
          validationReasons: [
            'Todos los firmantes completaron la firma',
            'Cadena de hashes verificada',
            tsa ? 'Sello de tiempo RFC 3161 obtenido' : 'Sin sello de tiempo RFC 3161 (TSA_URL no configurada)',
            signedManifest.signature ? 'Manifiesto firmado (Ed25519)' : 'Manifiesto sin firmar (falta llave)',
          ],
        },
      });
    } catch (error) {
      // Carrera: `sign()` (inline) y el activity `sealEvidence` de Temporal
      // pueden llamar a esto casi a la vez. El primero gana; el segundo relee.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.evidenceManifest.findUnique({ where: { signatureRequestId } });
        if (existing) return existing;
      }
      throw error;
    }

    // M14 — eventos CloudEvents (best-effort; no rompen el sellado).
    const tenantId = document.case.tenantId;
    await this.webhooks
      .emit(
        cloudEvent({
          type: EVENT_TYPES.requestCompleted,
          tenantId,
          subject: request.id,
          data: {
            signatureRequestId: request.id,
            documentId: document.id,
            order: request.order,
            signers: signedSigners.map((s) => ({
              signerId: s.signerId,
              signedAt: s.signedAt.toISOString(),
              method: s.usedMethod,
            })),
          },
        }),
      )
      .catch(() => undefined);
    await this.webhooks
      .emit(
        cloudEvent({
          type: EVENT_TYPES.evidenceSealed,
          tenantId,
          subject: manifest.manifestId,
          data: {
            manifestId: manifest.manifestId,
            signatureRequestId: request.id,
            documentId: document.id,
            packageHash: manifest.packageHash,
            manifestHash: manifest.manifestHash,
            timestampProvider: manifest.timestampProvider,
          },
        }),
      )
      .catch(() => undefined);

    return manifest;
  }

  /** Recompone el cuerpo canónico del manifiesto a partir de la fila guardada. */
  private manifestBodyOf(m: EvidenceManifest) {
    return {
      manifestId: m.manifestId,
      signatureRequestId: m.signatureRequestId,
      documentId: m.documentId,
      documentVersion: m.documentVersion,
      tenantId: m.tenantId,
      signingOrder: m.signingOrder,
      originalHash: m.originalHash,
      presentedHash: m.presentedHash,
      signedHash: m.signedHash,
      packageHash: m.packageHash,
      chainOfCustody: m.chainOfCustody,
      signatures: m.signatures,
      consentRecords: m.consentRecords,
      timestamp: {
        provider: m.timestampProvider,
        issuedAt: m.timestampIssuedAt.toISOString(),
        tokenHash: m.timestampTokenHash,
      },
      ...(m.signaturePolicy ? { signaturePolicy: m.signaturePolicy } : {}),
    };
  }

  async findByRequest(signatureRequestId: string, tenantId?: string): Promise<EvidenceManifest | null> {
    const found = await this.prisma.evidenceManifest.findUnique({ where: { signatureRequestId } });
    if (found && tenantId && found.tenantId !== tenantId) return null;
    return found;
  }

  async findByManifestId(manifestId: string, tenantId?: string): Promise<EvidenceManifest> {
    const found = await this.prisma.evidenceManifest.findUnique({ where: { manifestId } });
    if (!found || (tenantId && found.tenantId !== tenantId)) {
      throw new NotFoundException(`Manifiesto de evidencia ${manifestId} no encontrado`);
    }
    return found;
  }

  async verify(manifestId: string): Promise<EvidenceVerificationResult> {
    const manifest = await this.findByManifestId(manifestId);

    const request = await this.prisma.signatureRequest.findUnique({
      where: { id: manifest.signatureRequestId },
      include: INCLUDE_FOR_MANIFEST,
    });
    if (!request) {
      return {
        valid: false,
        mismatches: ['La solicitud de firma asociada ya no existe'],
        checks: {
          documentHash: false,
          signedHash: false,
          packageHash: false,
          chainOfCustody: false,
          manifestSignature: 'sin-firma',
          timestamp: 'sin-sello',
          auditChain: false,
          eventTimestamps: 'sin-sellos',
        },
      };
    }

    const document = request.document;
    const signedSigners = request.signers
      .filter((s): s is Signer & { signedAt: Date } => s.status === 'FIRMADO' && s.signedAt !== null)
      .sort((a, b) => a.signedAt.getTime() - b.signedAt.getTime());

    const mismatches: string[] = [];

    if (document.hash !== manifest.originalHash) {
      mismatches.push('originalHash no coincide con el hash actual del documento');
    }
    if (document.hash !== manifest.presentedHash) {
      mismatches.push('presentedHash no coincide con el hash actual del documento');
    }

    const recomputedSignedHash = this.hashSignedSet(signedSigners);
    if (recomputedSignedHash !== manifest.signedHash) {
      mismatches.push('signedHash no coincide con los datos de firmantes recalculados');
    }

    const recomputedPackageHash = createHash('sha256')
      .update(`${manifest.manifestId}${recomputedSignedHash}${manifest.documentId}`)
      .digest('hex');
    if (recomputedPackageHash !== manifest.packageHash) {
      mismatches.push('packageHash no coincide con el recálculo actual');
    }

    let previousHash = document.hash;
    const storedChain = manifest.chainOfCustody as unknown as ChainEvent[];
    let chainOk = storedChain.length === signedSigners.length;
    for (let i = 0; i < signedSigners.length; i++) {
      const signer = signedSigners[i];
      const at = signer.signedAt.toISOString();
      const eventData = JSON.stringify({
        action: 'SIGNATURE_APPLIED',
        actorId: signer.signerId,
        at,
        method: signer.usedMethod,
      });
      const hashAfter = createHash('sha256').update(previousHash + eventData).digest('hex');
      const storedEvent = storedChain[i];
      if (!storedEvent || storedEvent.hashAfter !== hashAfter) {
        mismatches.push(`Eslabón de cadena de custodia #${i + 1} (${signer.signerId}) no coincide`);
        chainOk = false;
      }
      previousHash = hashAfter;
    }
    if (storedChain.length !== signedSigners.length) {
      mismatches.push('El número de eventos en la cadena de custodia cambió');
    }

    // Firma Ed25519 del manifiesto.
    let manifestSigOk: boolean | 'sin-firma' = 'sin-firma';
    if (manifest.manifestSignature) {
      manifestSigOk = this.manifestSigner.verify(
        this.manifestBodyOf(manifest),
        manifest.manifestSignature,
      );
      if (!manifestSigOk) mismatches.push('La firma Ed25519 del manifiesto no valida');
      if (manifest.manifestHash && this.manifestSigner.hash(this.manifestBodyOf(manifest)) !== manifest.manifestHash) {
        mismatches.push('manifestHash no coincide con el recálculo del cuerpo canónico');
        manifestSigOk = false;
      }
    }

    // Sello de tiempo RFC 3161.
    let tsOk: boolean | 'sin-sello' = 'sin-sello';
    if (manifest.timestampToken) {
      const check = verifyTimestampToken(
        Buffer.from(manifest.timestampToken, 'base64'),
        Buffer.from(manifest.packageHash, 'hex'),
      );
      tsOk = check.valid;
      if (!check.valid) mismatches.push(`Sello de tiempo inválido: ${check.reason}`);
    }

    const auditChainCheck = await this.auditChain
      .verify({ signatureRequestId: manifest.signatureRequestId })
      .catch(() => ({ ok: false }));
    if (!auditChainCheck.ok) mismatches.push('Cadena de auditoría inmutable alterada o incompleta');

    // Fase B — sellos RFC 3161 por evento de firma.
    const manifestSignatures = (manifest.signatures as unknown as SignatureEntry[]) ?? [];
    const withEventTs = manifestSignatures.filter((s) => s.eventTimestamp?.tokenHash);
    let eventTimestamps: boolean | 'sin-sellos' = withEventTs.length ? true : 'sin-sellos';
    for (const s of withEventTs) {
      const stored = await this.prisma.signatureEventTimestamp.findFirst({
        where: { signatureRequestId: manifest.signatureRequestId, signerId: s.signerId },
      });
      const tokenOk =
        stored != null &&
        createHash('sha256').update(Buffer.from(stored.token, 'base64')).digest('hex') === s.eventTimestamp!.tokenHash &&
        /^[0-9a-f]{64}$/i.test(s.signatureHash) &&
        verifyTimestampToken(Buffer.from(stored.token, 'base64'), Buffer.from(s.signatureHash, 'hex')).valid;
      if (!tokenOk) {
        eventTimestamps = false;
        mismatches.push(`Sello RFC 3161 del evento de firma de ${s.signerId} inválido o ausente`);
      }
    }

    return {
      valid: mismatches.length === 0,
      mismatches,
      checks: {
        documentHash: document.hash === manifest.originalHash && document.hash === manifest.presentedHash,
        signedHash: recomputedSignedHash === manifest.signedHash,
        packageHash: recomputedPackageHash === manifest.packageHash,
        chainOfCustody: chainOk,
        manifestSignature: manifestSigOk,
        timestamp: tsOk,
        auditChain: auditChainCheck.ok,
        eventTimestamps,
      },
    };
  }

  /**
   * Expediente probatorio exportable (ZIP): PDF firmado + manifiesto + firma
   * Ed25519 + clave pública + token TSA + CA + verificador offline. Todo lo
   * necesario para validar sin el BFF.
   */
  async buildDossier(manifestId: string, tenantId?: string): Promise<EvidenceDossier> {
    const m = await this.findByManifestId(manifestId, tenantId);
    const doc = await this.prisma.document.findUnique({
      where: { id: m.documentId },
      select: { objectKey: true, enc: true },
    });
    if (!doc) throw new NotFoundException('El documento del manifiesto ya no existe');
    const pdf = await this.storage.getObject(doc.objectKey, doc.enc as unknown as EncMeta);

    const files: EvidenceDossier['files'] = [
      {
        path: 'manifiesto.json',
        content: JSON.stringify(
          {
            body: this.manifestBodyOf(m),
            manifestHash: m.manifestHash,
            manifestSignature: m.manifestSignature,
            manifestSigningKeyId: m.manifestSigningKeyId,
          },
          null,
          2,
        ),
      },
      { path: 'documento-firmado.pdf', content: pdf },
    ];

    if (this.manifestSigner.publicKeyPem) {
      files.push({ path: 'manifiesto.pub.pem', content: this.manifestSigner.publicKeyPem });
    }
    if (m.timestampToken) {
      files.push({ path: 'tsa-token.tsr', content: Buffer.from(m.timestampToken, 'base64') });
    }

    const caDir = join(
      process.cwd(),
      (process.env.PKI_DIR ?? 'pki').replace(/^\.\//, ''),
      'ca',
    );
    for (const f of ['root.cert.pem', 'intermediate.cert.pem']) {
      const p = join(caDir, f);
      if (existsSync(p)) files.push({ path: `ca/${f}`, content: readFileSync(p) });
    }

    // Verificador offline embebido.
    const verifierDir = join(process.cwd(), '..', '..', 'verifier');
    for (const f of ['verify.mjs', 'package.json']) {
      const p = join(verifierDir, f);
      if (existsSync(p)) files.push({ path: `verificador/${f}`, content: readFileSync(p) });
    }
    files.push({
      path: 'LEEME.txt',
      content:
        'EXPEDIENTE PROBATORIO — Prestige (SeguriData)\n\n' +
        `Manifiesto: ${m.manifestId}\n\n` +
        'Para verificar sin conexión:\n' +
        '  cd verificador && npm install && node verify.mjs ..\n\n' +
        'Comprueba: hash del manifiesto, firma Ed25519, cadena de custodia SHA-256,\n' +
        'signedHash/packageHash, firma PAdES/PKCS#7 del PDF (cadena a la CA) y el\n' +
        'sello de tiempo RFC 3161 sobre packageHash.\n',
    });

    return { manifestId: m.manifestId, files };
  }

  private hashSignedSet(signers: (Signer & { signedAt: Date })[]): string {
    const deterministic = [...signers]
      .map((s) => ({ signerId: s.signerId, signedAt: s.signedAt.toISOString(), usedMethod: s.usedMethod }))
      .sort((a, b) => a.signerId.localeCompare(b.signerId));
    return createHash('sha256').update(JSON.stringify(deterministic)).digest('hex');
  }
}
