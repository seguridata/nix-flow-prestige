import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Folder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface DriveContents {
  folder: Folder | null;
  /** De la raíz a la carpeta actual (incluida). */
  path: Pick<Folder, 'id' | 'name'>[];
  folders: (Folder & { itemCount: number })[];
  /** Expedientes y documentos sueltos (`loose`); la UI distingue cuál es cuál. */
  cases: {
    id: string;
    title: string;
    status: string;
    loose: boolean;
    createdAt: Date;
    documentCount: number;
    firstDocument: { id: string; filename: string; mimeType: string; sizeBytes: number } | null;
  }[];
}

export interface DriveActor {
  tenantId: string;
  ownerId: string;
}

/** Profundidad máxima del árbol: evita ciclos degenerados y rutas ilegibles. */
const MAX_DEPTH = 12;

@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Carpeta del usuario o 404 (nunca revela carpetas ajenas). */
  private async mine(id: string, actor: DriveActor): Promise<Folder> {
    const found = await this.prisma.folder.findFirst({
      where: { id, tenantId: actor.tenantId, ownerId: actor.ownerId },
    });
    if (!found) throw new NotFoundException('Carpeta no encontrada');
    return found;
  }

  private async pathOf(folder: Folder | null, actor: DriveActor): Promise<Pick<Folder, 'id' | 'name'>[]> {
    const path: Pick<Folder, 'id' | 'name'>[] = [];
    let cursor: Folder | null = folder;
    while (cursor && path.length <= MAX_DEPTH) {
      path.unshift({ id: cursor.id, name: cursor.name });
      cursor = cursor.parentId ? await this.mine(cursor.parentId, actor) : null;
    }
    return path;
  }

  async contents(folderId: string | null, actor: DriveActor): Promise<DriveContents> {
    const folder = folderId ? await this.mine(folderId, actor) : null;
    // En la raíz también salen los expedientes anteriores a las carpetas (ownerId nulo).
    const caseOwner = folderId
      ? { ownerId: actor.ownerId, folderId }
      : { OR: [{ ownerId: actor.ownerId }, { ownerId: null }], folderId: null };

    const [folders, cases, path] = await Promise.all([
      this.prisma.folder.findMany({
        where: { tenantId: actor.tenantId, ownerId: actor.ownerId, parentId: folderId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { children: true, cases: true } } },
      }),
      this.prisma.case.findMany({
        where: { tenantId: actor.tenantId, ...caseOwner },
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: {
          _count: { select: { documents: true } },
          documents: {
            take: 1,
            orderBy: { createdAt: 'asc' },
            select: { id: true, filename: true, mimeType: true, sizeBytes: true },
          },
        },
      }),
      this.pathOf(folder, actor),
    ]);

    return {
      folder,
      path,
      folders: folders.map(({ _count, ...f }) => ({ ...f, itemCount: _count.children + _count.cases })),
      cases: cases.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        loose: c.loose,
        createdAt: c.createdAt,
        documentCount: c._count.documents,
        firstDocument: c.documents[0] ?? null,
      })),
    };
  }

  private async assertUniqueName(name: string, parentId: string | null, actor: DriveActor, exceptId?: string) {
    const clash = await this.prisma.folder.findFirst({
      where: {
        tenantId: actor.tenantId,
        ownerId: actor.ownerId,
        parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`Ya existe una carpeta llamada «${name}» aquí`);
  }

  async create(name: string, parentId: string | null, actor: DriveActor): Promise<Folder> {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('El nombre no puede estar vacío');
    if (parentId) {
      const parent = await this.mine(parentId, actor);
      if ((await this.pathOf(parent, actor)).length >= MAX_DEPTH) {
        throw new BadRequestException('Se alcanzó la profundidad máxima de carpetas');
      }
    }
    await this.assertUniqueName(clean, parentId, actor);
    return this.prisma.folder.create({
      data: { tenantId: actor.tenantId, ownerId: actor.ownerId, parentId, name: clean },
    });
  }

  async update(id: string, patch: { name?: string; parentId?: string | null }, actor: DriveActor): Promise<Folder> {
    const folder = await this.mine(id, actor);
    const name = patch.name !== undefined ? patch.name.trim() : folder.name;
    if (!name) throw new BadRequestException('El nombre no puede estar vacío');
    const parentId = patch.parentId !== undefined ? patch.parentId : folder.parentId;

    if (parentId) {
      // No se puede mover una carpeta dentro de sí misma ni de sus descendientes.
      const target = await this.mine(parentId, actor);
      const targetPath = await this.pathOf(target, actor);
      if (targetPath.some((p) => p.id === id)) {
        throw new BadRequestException('No puedes mover una carpeta dentro de sí misma');
      }
      if (targetPath.length >= MAX_DEPTH) {
        throw new BadRequestException('Se alcanzó la profundidad máxima de carpetas');
      }
    }
    await this.assertUniqueName(name, parentId, actor, id);
    return this.prisma.folder.update({ where: { id }, data: { name, parentId } });
  }

  /** Solo borra carpetas vacías: nunca se pierde un expediente por accidente. */
  async remove(id: string, actor: DriveActor): Promise<void> {
    await this.mine(id, actor);
    const [children, cases] = await Promise.all([
      this.prisma.folder.count({ where: { parentId: id } }),
      this.prisma.case.count({ where: { folderId: id } }),
    ]);
    if (children + cases > 0) {
      throw new ConflictException('La carpeta no está vacía: mueve o elimina su contenido primero');
    }
    await this.prisma.folder.delete({ where: { id } });
  }

  /** Valida que `folderId` sea del usuario (para crear o mover expedientes dentro). */
  async assertOwned(folderId: string, actor: DriveActor): Promise<void> {
    await this.mine(folderId, actor);
  }
}
