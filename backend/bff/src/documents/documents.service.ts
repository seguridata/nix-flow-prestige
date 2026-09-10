import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Document } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { EncMeta } from '../storage/object-crypto';

export type { Document };

/** Vista pública de un documento: sin claves de storage ni metadatos de cifrado. */
export type SafeDocument = Omit<Document, 'objectKey' | 'enc'>;

export interface DocumentContent {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  hash: string;
}

const SAFE_SELECT = {
  id: true,
  caseId: true,
  tenantId: true,
  filename: true,
  version: true,
  hash: true,
  locked: true,
  sizeBytes: true,
  mimeType: true,
  createdAt: true,
} as const;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Registra un documento a partir de sus bytes (subida multipart). El PDF se
   * cifra y se guarda en object storage; la BD solo referencia `objectKey`,
   * `hash` y los metadatos de cifrado.
   */
  async create(params: {
    caseId: string;
    filename: string;
    bytes: Buffer;
    tenantId: string;
  }): Promise<SafeDocument> {
    const { caseId, filename, bytes, tenantId } = params;
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

    const stored = await this.storage.putObject({
      prefix: 'documents',
      filename,
      bytes,
      contentType: 'application/pdf',
    });

    return this.prisma.document.create({
      data: {
        caseId,
        tenantId,
        filename,
        version: 1,
        hash: stored.sha256,
        locked: false,
        objectKey: stored.objectKey,
        enc: stored.enc as unknown as object,
        sizeBytes: stored.sizeBytes,
        mimeType: 'application/pdf',
      },
      select: SAFE_SELECT,
    });
  }

  /**
   * Reemplaza el contenido del documento por una nueva versión (p. ej. tras
   * sellar la autógrafa). Sube un objeto nuevo, actualiza `hash`/`objectKey`
   * y bumpea `version`. Devuelve el hash nuevo.
   */
  async replaceContent(id: string, bytes: Buffer): Promise<{ hash: string; version: number }> {
    const current = await this.prisma.document.findUnique({
      where: { id },
      select: { id: true, filename: true, version: true },
    });
    if (!current) throw new NotFoundException(`Documento ${id} no encontrado`);

    const stored = await this.storage.putObject({
      prefix: 'documents',
      filename: current.filename,
      bytes,
      contentType: 'application/pdf',
    });
    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        hash: stored.sha256,
        objectKey: stored.objectKey,
        enc: stored.enc as unknown as object,
        sizeBytes: stored.sizeBytes,
        version: current.version + 1,
      },
      select: { hash: true, version: true },
    });
    return updated;
  }

  list(caseId?: string, tenantId?: string): Promise<SafeDocument[]> {
    return this.prisma.document.findMany({
      where: { ...(tenantId ? { tenantId } : {}), ...(caseId ? { caseId } : {}) },
      orderBy: { createdAt: 'desc' },
      select: SAFE_SELECT,
    });
  }

  find(id: string, tenantId?: string): Promise<SafeDocument | null> {
    return this.prisma.document.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: SAFE_SELECT,
    });
  }

  async get(id: string, tenantId?: string): Promise<SafeDocument> {
    const found = await this.find(id, tenantId);
    if (!found) throw new NotFoundException(`Documento ${id} no encontrado`);
    return found;
  }

  /** Descarga y descifra el contenido del documento desde el storage. */
  async getContent(id: string, tenantId?: string): Promise<DocumentContent> {
    const doc = await this.prisma.document.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { objectKey: true, enc: true, mimeType: true, filename: true, hash: true },
    });
    if (!doc) throw new NotFoundException(`Documento ${id} no encontrado`);
    const bytes = await this.storage.getObject(doc.objectKey, doc.enc as unknown as EncMeta);
    return { bytes, mimeType: doc.mimeType, filename: doc.filename, hash: doc.hash };
  }
}
