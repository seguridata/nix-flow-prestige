import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { withTickLock } from '../common/advisory-lock';
import { CollaborationService } from '../collaboration/collaboration.service';
import { DocumentsService, sha256Hex } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { EncMeta } from '../storage/object-crypto';
import { StorageService } from '../storage/storage.service';
import { parseAttachmentSpecs, type AttachmentSpec } from './attachment-specs';
import { acceptedBy, sniffContent, type DetectedKind } from './content-sniff';
import { sanitizeFilename } from './filename';

/** Vigencia de una carga previa. */
export const STAGING_TTL_MS = 24 * 3600_000;
/** El registro en Redis vive más que la vigencia lógica: así el barrido encuentra el objeto aunque se atrase. */
const META_TTL_S = 7 * 24 * 3600;
const CLAIM_TTL_S = 3600;
/** Cargas previas sin usar que un usuario puede tener a la vez (tope anti-abuso de almacenamiento). */
export const MAX_STAGED_PER_USER = 100;
const EXPIRY_INDEX = 'attach:expiry';
const SWEEP_BATCH = 200;
const SWEEP_MAX_BATCHES = 10;
const MAX_LIST = 500;

export interface AttachmentActor {
  tenantId: string;
  actorId: string;
  name?: string;
}

export interface StagedMeta {
  stagedId: string;
  tenantId: string;
  actorId: string;
  templateId: string;
  specKey: string;
  name: string;
  size: number;
  mime: string;
  kind: DetectedKind;
  sha256: string;
  objectKey: string;
  enc: EncMeta;
  createdAt: number;
  expiresAt: number;
}

export interface ResolvedAttachment {
  specKey: string;
  meta: StagedMeta;
}

export interface MaterializedAttachment {
  documentId: string;
  specKey: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
}

export interface AttachmentListItem {
  documentId: string;
  attachmentKey: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  hash: string;
}

const kMeta = (tenantId: string, stagedId: string) => `attach:staged:${tenantId}:${stagedId}`;
const kUsed = (tenantId: string, stagedId: string) => `attach:used:${tenantId}:${stagedId}`;
const kSpec = (a: AttachmentActor, templateId: string, specKey: string) => `attach:spec:${a.tenantId}:${a.actorId}:${templateId}:${specKey}`;
const kUser = (a: AttachmentActor) => `attach:user:${a.tenantId}:${a.actorId}`;

/**
 * ADR-008 §7 — anexos de un formato: carga previa (staging) por tenant y usuario, validación de TODO antes de crear
 * nada, materialización como `Document` del expediente y lectura autorizada.
 *
 * Sin estado en el proceso: los bytes viven cifrados en el storage (prefijo del tenant, AAD de tenant) y los
 * metadatos en Redis con TTL. Sin Redis el staging no está disponible (503): no hay respaldo en memoria.
 */
@Injectable()
export class AttachmentsService {
  private readonly log = new Logger(AttachmentsService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly documents: DocumentsService,
    private readonly collab: CollaborationService,
  ) {}

  private r(): Redis {
    const c = this.redis.client();
    if (!c) throw new ServiceUnavailableException('Los anexos requieren Redis (REDIS_URL) y no está configurado');
    return c;
  }

  // ───────────────────────── carga previa ─────────────────────────

  async stage(
    templateId: string,
    specKey: string | undefined,
    file: { buffer: Buffer; originalname?: string } | undefined,
    actor: AttachmentActor,
  ) {
    const redis = this.r();
    const tpl = await this.prisma.documentTemplate.findFirst({
      // Solo formatos PUBLICADOS: es lo que ve un usuario normal (un borrador responde 404 incluso al admin).
      where: { id: templateId, tenantId: actor.tenantId, published: true },
      select: { id: true, attachmentSpecs: true },
    });
    if (!tpl) throw new NotFoundException('Formato no encontrado');
    const spec = parseAttachmentSpecs(tpl.attachmentSpecs).specs.find((s) => s.key === specKey);
    if (!spec) throw new BadRequestException('Indica un anexo válido del formato (specKey)');
    if (!file?.buffer?.length) throw new BadRequestException('Falta el archivo');
    if (file.buffer.length > spec.maxSizeMB * 1024 * 1024) {
      throw new HttpException(`«${spec.label}» admite archivos de hasta ${spec.maxSizeMB} MB`, HttpStatus.PAYLOAD_TOO_LARGE);
    }

    const sniff = sniffContent(file.buffer);
    if (!sniff.ok) throw new BadRequestException(sniff.detail);
    if (!acceptedBy(sniff.kind, spec.accept)) {
      throw new BadRequestException(`«${spec.label}» no acepta este tipo de archivo (se detectó ${sniff.ext.toUpperCase()}); admite: ${spec.accept.join(', ')}`);
    }

    const specSet = kSpec(actor, tpl.id, spec.key);
    const userSet = kUser(actor);
    if ((await redis.scard(specSet)) >= spec.max) {
      throw new ConflictException(`«${spec.label}» admite como máximo ${spec.max} archivo(s); quita uno antes de cargar otro`);
    }
    if ((await redis.scard(userSet)) >= MAX_STAGED_PER_USER) {
      throw new HttpException('Tienes demasiados archivos sin usar; usa o quita algunos', HttpStatus.TOO_MANY_REQUESTS);
    }

    const name = sanitizeFilename(file.originalname, sniff.ext);
    const stagedId = randomUUID();
    const stored = await this.storage.putObject({
      prefix: `documents/${actor.tenantId}/staged`,
      filename: name,
      bytes: file.buffer,
      contentType: sniff.mime,
      tenantId: actor.tenantId,
    });
    const now = Date.now();
    const meta: StagedMeta = {
      stagedId,
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      templateId: tpl.id,
      specKey: spec.key,
      name,
      size: stored.sizeBytes,
      mime: sniff.mime,
      kind: sniff.kind,
      sha256: stored.sha256,
      objectKey: stored.objectKey,
      enc: stored.enc,
      createdAt: now,
      expiresAt: now + STAGING_TTL_MS,
    };
    await redis.set(kMeta(actor.tenantId, stagedId), JSON.stringify(meta), 'EX', META_TTL_S);
    await redis.zadd(EXPIRY_INDEX, meta.expiresAt, JSON.stringify([actor.tenantId, stagedId]));
    await redis.sadd(specSet, stagedId);
    await redis.expire(specSet, META_TTL_S);
    await redis.sadd(userSet, stagedId);
    await redis.expire(userSet, META_TTL_S);

    // Dos cargas simultáneas pudieron pasar la comprobación: la que rebasa el máximo se revierte.
    if ((await redis.scard(specSet)) > spec.max) {
      await this.dropStaged(meta);
      throw new ConflictException(`«${spec.label}» admite como máximo ${spec.max} archivo(s)`);
    }
    return { stagedId, name, size: meta.size, mime: meta.mime, sha256: meta.sha256 };
  }

  /** Quita una carga previa propia que aún no se usa. */
  async discard(stagedId: string, actor: AttachmentActor): Promise<void> {
    const redis = this.r();
    const meta = await this.load(stagedId, actor);
    if (!meta) throw new NotFoundException('Archivo no encontrado');
    if (await redis.exists(kUsed(actor.tenantId, stagedId))) {
      throw new ConflictException('El archivo ya se está usando en una solicitud');
    }
    await this.dropStaged(meta);
  }

  /** Metadatos de una carga del MISMO tenant y usuario; cualquier otra cosa responde como «no existe». */
  private async load(stagedId: string, actor: AttachmentActor): Promise<StagedMeta | null> {
    if (!/^[0-9a-f-]{36}$/i.test(stagedId)) return null;
    const raw = await this.r().get(kMeta(actor.tenantId, stagedId));
    if (!raw) return null;
    const meta = JSON.parse(raw) as StagedMeta;
    return meta.tenantId === actor.tenantId && meta.actorId === actor.actorId ? meta : null;
  }

  /** Borra objeto y metadatos de una carga. Con `strict` un fallo del storage se propaga SIN tocar Redis (el barrido reintenta). */
  private async dropStaged(meta: StagedMeta, strict = false): Promise<void> {
    const redis = this.r();
    try {
      await this.storage.deleteObject(meta.objectKey, meta.tenantId);
    } catch (e) {
      if (strict) throw e;
      this.log.warn(`No se pudo borrar ${meta.objectKey}: ${(e as Error).message}`);
    }
    const a = { tenantId: meta.tenantId, actorId: meta.actorId };
    await redis.del(kMeta(meta.tenantId, meta.stagedId));
    await redis.srem(kSpec(a, meta.templateId, meta.specKey), meta.stagedId);
    await redis.srem(kUser(a), meta.stagedId);
    await redis.zrem(EXPIRY_INDEX, JSON.stringify([meta.tenantId, meta.stagedId]));
  }

  // ───────────────────────── instantiate ─────────────────────────

  /**
   * Valida TODA la selección de anexos sin efectos secundarios: requeridos, mínimo y máximo, tipo, tamaño, que cada
   * carga sea del mismo tenant y usuario, del mismo formato y anexo, vigente y sin usar. Junta todos los errores.
   */
  async resolveSelection(
    tpl: { id: string; attachmentSpecs?: unknown },
    selection: unknown,
    actor: AttachmentActor,
  ): Promise<ResolvedAttachment[]> {
    const specs = parseAttachmentSpecs(tpl.attachmentSpecs).specs;
    if (selection === undefined || selection === null) selection = {};
    if (typeof selection !== 'object' || Array.isArray(selection)) throw new BadRequestException('Los anexos deben ser un objeto {anexo: [archivos]}');
    const sel = selection as Record<string, unknown>;
    if (specs.length === 0 && Object.keys(sel).length === 0) return [];

    const errors: string[] = [];
    const known = new Set(specs.map((s) => s.key));
    for (const k of Object.keys(sel)) if (!known.has(k)) errors.push(`El formato no pide el anexo «${k.slice(0, 40)}»`);

    const wanted: { spec: AttachmentSpec; ids: string[] }[] = [];
    for (const spec of specs) {
      const raw = sel[spec.key] ?? [];
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
        errors.push(`«${spec.label}»: la lista de archivos no es válida`);
        continue;
      }
      const ids = raw as string[];
      if (new Set(ids).size !== ids.length) errors.push(`«${spec.label}»: hay archivos repetidos`);
      if (ids.length === 0 && spec.required) errors.push(`Falta el anexo «${spec.label}»`);
      else if (ids.length < spec.min) errors.push(`«${spec.label}»: se piden al menos ${spec.min} archivo(s) y llevas ${ids.length}`);
      if (ids.length > spec.max) errors.push(`«${spec.label}»: se admiten como máximo ${spec.max} archivo(s)`);
      wanted.push({ spec, ids: ids.slice(0, spec.max + 1) });
    }

    const flat = wanted.flatMap((w) => w.ids.map((id) => ({ spec: w.spec, id })));
    const resolved: ResolvedAttachment[] = [];
    if (flat.length && errors.length === 0) {
      const redis = this.r();
      const valid = flat.filter((f) => /^[0-9a-f-]{36}$/i.test(f.id));
      if (valid.length !== flat.length) errors.push('Uno de los archivos adjuntos no es válido; vuelve a cargarlo');
      const metas = valid.length ? await redis.mget(...valid.map((f) => kMeta(actor.tenantId, f.id))) : [];
      const used = valid.length ? await redis.mget(...valid.map((f) => kUsed(actor.tenantId, f.id))) : [];
      const now = Date.now();
      valid.forEach((f, i) => {
        const raw = metas[i];
        const meta = raw ? (JSON.parse(raw) as StagedMeta) : null;
        // Otro tenant/usuario responde igual que «no existe»: no se revela nada.
        if (!meta || meta.tenantId !== actor.tenantId || meta.actorId !== actor.actorId) {
          return void errors.push(`«${f.spec.label}»: un archivo no existe o ya caducó; vuelve a cargarlo`);
        }
        if (meta.expiresAt <= now) return void errors.push(`«${f.spec.label}»: el archivo «${meta.name}» caducó; vuelve a cargarlo`);
        if (meta.templateId !== tpl.id || meta.specKey !== f.spec.key) {
          return void errors.push(`«${f.spec.label}»: el archivo «${meta.name}» se cargó para otro anexo`);
        }
        if (used[i]) return void errors.push(`«${f.spec.label}»: el archivo «${meta.name}» ya se usó en otra solicitud`);
        if (meta.size > f.spec.maxSizeMB * 1024 * 1024) return void errors.push(`«${f.spec.label}»: «${meta.name}» pesa más de ${f.spec.maxSizeMB} MB`);
        if (!acceptedBy(meta.kind, f.spec.accept)) return void errors.push(`«${f.spec.label}»: «${meta.name}» no es de un tipo aceptado`);
        resolved.push({ specKey: f.spec.key, meta });
      });
    }
    if (errors.length) throw new BadRequestException({ message: 'Revisa los anexos', errors });
    return resolved;
  }

  /** Reserva atómica (SET NX) de cada carga: una carga solo puede ir a UNA solicitud. Todo o nada. */
  async claim(resolved: ResolvedAttachment[]): Promise<void> {
    if (!resolved.length) return;
    const redis = this.r();
    const taken: ResolvedAttachment[] = [];
    for (const a of resolved) {
      const ok = await redis.set(kUsed(a.meta.tenantId, a.meta.stagedId), '1', 'EX', CLAIM_TTL_S, 'NX');
      if (ok !== 'OK') {
        await this.release(taken);
        throw new ConflictException(`El archivo «${a.meta.name}» ya se usó en otra solicitud`);
      }
      taken.push(a);
    }
  }

  async release(resolved: ResolvedAttachment[]): Promise<void> {
    if (!resolved.length) return;
    const redis = this.r();
    await redis.del(...resolved.map((a) => kUsed(a.meta.tenantId, a.meta.stagedId))).catch(() => undefined);
  }

  /**
   * Cada carga pasa a ser un `Document` del expediente (`attachmentKey`, cifrado con AAD del tenant, hash, congelado).
   * Si falla a la mitad se liberan las reservas (las cargas siguen vigentes para reintentar).
   */
  async materialize(resolved: ResolvedAttachment[], ctx: { caseId: string; actor: AttachmentActor }): Promise<MaterializedAttachment[]> {
    const out: MaterializedAttachment[] = [];
    try {
      for (const a of resolved) {
        const bytes = await this.storage.getObject(a.meta.objectKey, a.meta.enc, a.meta.tenantId).catch(() => {
          throw new ConflictException(`El archivo «${a.meta.name}» ya no está disponible; vuelve a cargarlo`);
        });
        if (sha256Hex(bytes) !== a.meta.sha256) {
          throw new ConflictException({ error: 'HASH_MISMATCH', message: `El archivo «${a.meta.name}» no coincide con el SHA-256 de su carga` });
        }
        const doc = await this.documents.create({
          caseId: ctx.caseId,
          filename: a.meta.name,
          bytes,
          tenantId: ctx.actor.tenantId,
          actorId: ctx.actor.actorId,
          actorName: ctx.actor.name,
          attachmentKey: a.specKey,
          mimeType: a.meta.mime,
        });
        out.push({ documentId: doc.id, specKey: a.specKey, sha256: doc.hash, sizeBytes: doc.sizeBytes, mimeType: doc.mimeType });
      }
    } catch (e) {
      await this.release(resolved);
      throw e;
    }
    // Ya son Documents: las cargas previas sobran (best-effort; el barrido recoge lo que quede).
    for (const a of resolved) await this.dropStaged(a.meta).catch((e: Error) => this.log.warn(`dropStaged: ${e.message}`));
    return out;
  }

  /** Evento `ATTACHMENTS_ADDED`: por anexo, conteo y hash. Sin nombres de archivo (pueden ser personales). */
  async recordAdded(
    items: MaterializedAttachment[],
    ctx: { caseId: string; signatureRequestId: string; documentId: string; actor: AttachmentActor },
  ): Promise<void> {
    if (!items.length) return;
    const specs: Record<string, { count: number; hash: string; hashes: string[] }> = {};
    for (const it of items) {
      const s = (specs[it.specKey] ??= { count: 0, hash: '', hashes: [] });
      s.count += 1;
      s.hashes.push(it.sha256);
    }
    for (const s of Object.values(specs)) {
      s.hashes.sort();
      s.hash = createHash('sha256').update(s.hashes.join('\n')).digest('hex');
    }
    await this.collab.audit({
      signatureRequestId: ctx.signatureRequestId,
      documentId: ctx.documentId,
      actorId: ctx.actor.actorId,
      actorName: ctx.actor.name,
      tenantId: ctx.actor.tenantId,
      action: 'ATTACHMENTS_ADDED',
      payload: { tenantId: ctx.actor.tenantId, actorId: ctx.actor.actorId, caseId: ctx.caseId, specs },
    });
  }

  // ───────────────────────── lectura ─────────────────────────

  /** Anexos de un expediente: solo su dueño y los firmantes/destinatarios de sus solicitudes (404 para los demás). */
  async listForCase(caseId: string, actor: AttachmentActor): Promise<AttachmentListItem[]> {
    if (!(await this.documents.participatesInCase(caseId, actor.tenantId, actor.actorId))) {
      throw new NotFoundException(`Caso ${caseId} no encontrado`);
    }
    const rows = await this.prisma.document.findMany({
      where: { caseId, tenantId: actor.tenantId, attachmentKey: { not: null } },
      orderBy: [{ attachmentKey: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_LIST,
      select: { id: true, attachmentKey: true, filename: true, sizeBytes: true, mimeType: true, hash: true },
    });
    return rows.map((d) => ({
      documentId: d.id,
      attachmentKey: d.attachmentKey as string,
      filename: d.filename,
      sizeBytes: d.sizeBytes,
      mimeType: d.mimeType,
      hash: d.hash,
    }));
  }

  // ───────────────────────── barrido ─────────────────────────

  @Interval('attachments-staging-sweep', 10 * 60_000)
  async tick() {
    if (this.sweeping || !this.redis.enabled) return;
    this.sweeping = true;
    try {
      await withTickLock({ redis: this.redis, prisma: this.prisma }, 'prestige:attachments-sweep', () => this.sweepExpired());
    } catch (error) {
      this.log.error(`sweepExpired: ${(error as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Borra del storage y de Redis las cargas previas caducadas. Idempotente (dos réplicas a la vez no se estorban:
   * borrar dos veces es inocuo) y no toca una carga reservada por un `instantiate` en curso.
   */
  async sweepExpired(now = Date.now()): Promise<{ removed: number; skipped: number }> {
    if (!this.redis.client()) return { removed: 0, skipped: 0 };
    const redis = this.r();
    let removed = 0;
    let skipped = 0;
    for (let b = 0; b < SWEEP_MAX_BATCHES; b++) {
      const members = await redis.zrangebyscore(EXPIRY_INDEX, '-inf', now, 'LIMIT', skipped, SWEEP_BATCH);
      if (members.length === 0) break;
      for (const member of members) {
        let tenantId: string;
        let stagedId: string;
        try {
          [tenantId, stagedId] = JSON.parse(member) as [string, string];
        } catch {
          await redis.zrem(EXPIRY_INDEX, member);
          continue;
        }
        if (await redis.exists(kUsed(tenantId, stagedId))) {
          skipped += 1;
          continue;
        }
        const raw = await redis.get(kMeta(tenantId, stagedId));
        if (!raw) {
          await redis.zrem(EXPIRY_INDEX, member);
          continue;
        }
        const meta = JSON.parse(raw) as StagedMeta;
        try {
          await this.dropStaged(meta, true);
        } catch (e) {
          this.log.warn(`Barrido: no se pudo borrar ${meta.objectKey}: ${(e as Error).message}`);
          skipped += 1;
          continue;
        }
        removed += 1;
      }
      if (members.length < SWEEP_BATCH) break;
    }
    if (removed) this.log.log(`Barrido de anexos: ${removed} carga(s) caducada(s) borrada(s)`);
    return { removed, skipped };
  }
}
