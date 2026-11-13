import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { FoldersService, type DriveActor } from './folders.service';

/**
 * Acciones sobre expedientes y documentos de "Mis documentos": copiar y eliminar.
 *
 * Eliminar solo procede mientras el expediente sea un borrador: en cuanto alguno de sus documentos tiene
 * solicitud de firma, evidencia o comentarios, es evidencia y se conserva (409). Las copias son documentos
 * nuevos (hash, cifrado y auditoría propios); los anexos de una solicitud no se copian.
 */
@Injectable()
export class DriveItemsService {
  private readonly logger = new Logger(DriveItemsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    private readonly folders: FoldersService,
  ) {}

  /** Expediente del usuario (o anterior a las carpetas, `ownerId` nulo) o 404. */
  private async mine(id: string, actor: DriveActor) {
    const found = await this.prisma.case.findFirst({
      where: { id, tenantId: actor.tenantId, OR: [{ ownerId: actor.ownerId }, { ownerId: null }] },
      include: { documents: { select: { id: true, filename: true, objectKey: true, presentedObjectKey: true, attachmentKey: true } } },
    });
    if (!found) throw new NotFoundException('Expediente no encontrado');
    return found;
  }

  async removeCase(id: string, actor: DriveActor): Promise<void> {
    const kase = await this.mine(id, actor);
    const docIds = kase.documents.map((d) => d.id);
    if (docIds.length) {
      const [requests, evidence, comments] = await Promise.all([
        this.prisma.signatureRequest.count({ where: { tenantId: actor.tenantId, documentId: { in: docIds } } }),
        this.prisma.evidenceManifest.count({ where: { tenantId: actor.tenantId, documentId: { in: docIds } } }),
        this.prisma.documentComment.count({ where: { tenantId: actor.tenantId, documentId: { in: docIds } } }),
      ]);
      if (requests + evidence + comments > 0) {
        throw new ConflictException(
          'Ya se envió a firma o tiene evidencia o comentarios: se conserva como evidencia y no se puede eliminar',
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.signatureField.deleteMany({ where: { tenantId: actor.tenantId, documentId: { in: docIds } } }),
      this.prisma.document.deleteMany({ where: { tenantId: actor.tenantId, caseId: id } }),
      this.prisma.case.delete({ where: { id, tenantId: actor.tenantId } }),
    ]);
    // Los objetos cifrados se retiran después; si falla, no queda ninguna fila que los referencie.
    for (const d of kase.documents) {
      for (const key of [d.objectKey, d.presentedObjectKey]) {
        if (!key) continue;
        await this.storage.deleteObject(key, actor.tenantId).catch((e: unknown) =>
          this.logger.warn(`No se pudo retirar el objeto ${key}: ${e instanceof Error ? e.message : String(e)}`),
        );
      }
    }
  }

  /** Copia un expediente o documento suelto a `folderId` (null = raíz). Devuelve el expediente nuevo. */
  async copyCase(id: string, folderId: string | null, actor: DriveActor & { actorName?: string }) {
    const source = await this.mine(id, actor);
    if (folderId) await this.folders.assertOwned(folderId, actor);
    const originals = source.documents.filter((d) => !d.attachmentKey);
    const copy = await this.prisma.case.create({
      data: {
        tenantId: actor.tenantId,
        title: `${source.title} (copia)`.slice(0, 200),
        ownerId: actor.ownerId,
        folderId,
        loose: source.loose,
      },
    });
    try {
      for (const d of originals) {
        const { bytes, filename } = await this.documents.getContent(d.id, actor.tenantId, { actorId: actor.ownerId });
        await this.documents.create({
          caseId: copy.id,
          filename,
          bytes,
          tenantId: actor.tenantId,
          actorId: actor.ownerId,
          actorName: actor.actorName,
        });
      }
    } catch (e) {
      await this.removeCase(copy.id, actor).catch(() => undefined);
      throw e;
    }
    return copy;
  }
}
