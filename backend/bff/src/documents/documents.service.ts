import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Document } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export type { Document };
export type SafeDocument = Omit<Document, 'contentBase64'>;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(body: { caseId: string; filename: string; contentBase64: string }): Promise<SafeDocument> {
    const bytes = Buffer.from(body.contentBase64, 'base64');
    const stored = await this.storage.putPdf(bytes, body.filename);
    const hash = stored.hash || createHash('sha256').update(body.contentBase64, 'base64').digest('hex');
    const created = await this.prisma.document.create({
      data: {
        caseId: body.caseId,
        filename: body.filename,
        version: 1,
        hash,
        locked: false,
        contentBase64: body.contentBase64,
        objectKey: stored.objectKey,
        mimeType: 'application/pdf',
      },
    });
    return this.omitContent(created);
  }

  async list(caseId?: string): Promise<SafeDocument[]> {
    const items = await this.prisma.document.findMany({
      where: caseId ? { caseId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return items.map((d) => this.omitContent(d));
  }

  find(id: string): Promise<Document | null> {
    return this.prisma.document.findUnique({ where: { id } });
  }

  async getOrThrow(id: string): Promise<Document> {
    const found = await this.find(id);
    if (!found) throw new NotFoundException(`Documento ${id} no encontrado`);
    return found;
  }

  private omitContent(record: Document): SafeDocument {
    const { contentBase64, ...safe } = record;
    return safe;
  }
}
