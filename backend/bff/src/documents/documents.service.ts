import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Document } from '@prisma/client';
import { CollaborationService } from '../collaboration/collaboration.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { STABLE_ORDER, finishPage, pageArgs, prismaPage, type Page, type PageQueryDto } from '../common/pagination';
import type { EncMeta } from '../storage/object-crypto';

export type { Document };

/** Vista pública: sin claves de storage ni metadatos de cifrado. */
export interface PublicDocument {
  id: string;
  caseId: string;
  tenantId: string;
  filename: string;
  version: number;
  /** SHA-256 hex de los bytes canónicos. Alias estable de `hash`. */
  hash: string;
  sha256: string;
  locked: boolean;
  frozenAt: Date | null;
  /** Hay una copia de ceremonia. El canónico no se movió. */
  hasPresented: boolean;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
}

export interface DocumentContent {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  hash: string;
}

const ROW_SELECT = {
  id: true,
  caseId: true,
  tenantId: true,
  filename: true,
  version: true,
  hash: true,
  locked: true,
  frozenAt: true,
  presentedObjectKey: true,
  sizeBytes: true,
  mimeType: true,
  createdAt: true,
} as const;

type DocumentRow = {
  id: string;
  caseId: string;
  tenantId: string;
  filename: string;
  version: number;
  hash: string;
  locked: boolean;
  frozenAt: Date | null;
  presentedObjectKey: string | null;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
};

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function publish(row: DocumentRow): PublicDocument {
  const { presentedObjectKey, ...rest } = row;
  return { ...rest, sha256: row.hash, hasPresented: Boolean(presentedObjectKey) };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly collab: CollaborationService,
  ) {}

  /**
   * Alta desde bytes. El PDF se cifra y se guarda en object storage.
   * La fila guarda el SHA-256 de esos bytes, nunca el base64.
   */
  async create(params: {
    caseId: string;
    filename: string;
    bytes: Buffer;
    tenantId: string;
    actorId: string;
    actorName?: string;
  }): Promise<PublicDocument> {
    const { caseId, filename, bytes, tenantId, actorId, actorName } = params;
    if (!bytes?.length) {
      throw new BadRequestException('El archivo está vacío');
    }
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestException('El archivo no es un PDF válido');
    }
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, tenantId: true },
    });
    if (!kase || kase.tenantId !== tenantId) throw new NotFoundException(`Caso ${caseId} no encontrado`);

    const sha256 = sha256Hex(bytes);
    const stored = await this.storage.putObject({
      prefix: `documents/${tenantId}/${caseId}`,
      filename,
      bytes,
      contentType: 'application/pdf',
    });
    if (stored.sha256 !== sha256) {
      throw new ConflictException({
        error: 'HASH_MISMATCH',
        message: 'El storage devolvió un SHA-256 distinto al de los bytes subidos',
      });
    }

    const created = await this.prisma.document.create({
      data: {
        caseId,
        tenantId,
        filename,
        version: 1,
        hash: sha256,
        locked: false,
        objectKey: stored.objectKey,
        enc: stored.enc as unknown as object,
        sizeBytes: stored.sizeBytes,
        mimeType: 'application/pdf',
      },
      select: ROW_SELECT,
    });

    await this.collab.audit({
      documentId: created.id,
      actorId,
      actorName,
      action: 'DOC_UPLOADED',
      payload: { sha256, tenantId, filename, sizeBytes: stored.sizeBytes },
    });

    return publish(created);
  }

  /**
   * Congela el canónico. Idempotente: un segundo freeze devuelve la misma fila.
   * Atómico: `updateMany` condicionado a `locked:false`, de modo que dos freeze
   * paralelos sólo auditan una vez. No existe operación de reemplazo del canónico:
   * para otro contenido se sube un documento nuevo.
   */
  async freeze(id: string, tenantId: string, actorId: string, actorName?: string): Promise<PublicDocument> {
    const current = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: { ...ROW_SELECT, objectKey: true, enc: true },
    });
    if (!current) throw new NotFoundException(`Documento ${id} no encontrado`);

    const bytes = await this.storage.getObject(current.objectKey, current.enc as unknown as EncMeta);
    const live = sha256Hex(bytes);
    if (live !== current.hash) {
      throw new ConflictException({
        error: 'HASH_MISMATCH',
        message: 'El objeto en storage no coincide con el SHA-256 registrado',
      });
    }

    if (current.locked) return publish(current);

    const frozenAt = new Date();
    const claimed = await this.prisma.document.updateMany({
      where: { id, tenantId, locked: false },
      data: { locked: true, frozenAt },
    });
    const updated = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: ROW_SELECT,
    });
    if (!updated) throw new NotFoundException(`Documento ${id} no encontrado`);
    // Otro freeze concurrente ganó la carrera: idempotente, sin doble auditoría.
    if (claimed.count === 0) return publish(updated);

    await this.collab.audit({
      documentId: id,
      actorId,
      actorName,
      action: 'DOC_FROZEN',
      payload: { sha256: current.hash, tenantId, frozenAt: frozenAt.toISOString() },
    });

    return publish(updated);
  }

  async list(
    caseId: string | undefined,
    tenantId: string,
    page?: PageQueryDto,
  ): Promise<PublicDocument[] | Page<PublicDocument>> {
    const args = pageArgs(page);
    const rows = await this.prisma.document.findMany({
      where: { tenantId, ...(caseId ? { caseId } : {}) },
      orderBy: STABLE_ORDER,
      select: ROW_SELECT,
      ...prismaPage(args),
    });
    return finishPage(rows.map(publish), args);
  }

  /** Carga en lote (una sola consulta) para evitar N+1 en la bandeja. */
  async findManyByIds(ids: string[], tenantId?: string): Promise<Map<string, PublicDocument>> {
    if (!tenantId || ids.length === 0) return new Map();
    const rows = await this.prisma.document.findMany({
      where: { id: { in: [...new Set(ids)] }, tenantId },
      select: ROW_SELECT,
    });
    return new Map(rows.map((r) => [r.id, publish(r)]));
  }

  find(id: string, tenantId?: string): Promise<PublicDocument | null> {
    if (!tenantId) return Promise.resolve(null);
    return this.prisma.document
      .findFirst({ where: { id, tenantId }, select: ROW_SELECT })
      .then((row) => (row ? publish(row) : null));
  }

  async get(id: string, tenantId: string): Promise<PublicDocument> {
    const found = await this.find(id, tenantId);
    if (!found) throw new NotFoundException(`Documento ${id} no encontrado`);
    return found;
  }

  /** Bytes canónicos descifrados. Nunca el base64, nunca la copia firmada. */
  async getContent(id: string, tenantId: string): Promise<DocumentContent> {
    const doc = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: { objectKey: true, enc: true, mimeType: true, filename: true, hash: true },
    });
    if (!doc) throw new NotFoundException(`Documento ${id} no encontrado`);
    const bytes = await this.storage.getObject(doc.objectKey, doc.enc as unknown as EncMeta);
    return { bytes, mimeType: doc.mimeType, filename: doc.filename, hash: doc.hash };
  }

  /** Copia de ceremonia, si la firma ya escribió una. */
  async getPresented(id: string, tenantId: string): Promise<DocumentContent> {
    const doc = await this.prisma.document.findFirst({
      where: { id, tenantId },
      select: {
        presentedObjectKey: true,
        presentedEnc: true,
        presentedHash: true,
        mimeType: true,
        filename: true,
      },
    });
    if (!doc?.presentedObjectKey || !doc.presentedEnc) {
      throw new NotFoundException(`Documento ${id} no tiene copia firmada`);
    }
    const bytes = await this.storage.getObject(doc.presentedObjectKey, doc.presentedEnc as unknown as EncMeta);
    return {
      bytes,
      mimeType: doc.mimeType,
      filename: doc.filename,
      hash: doc.presentedHash ?? sha256Hex(bytes),
    };
  }
}
