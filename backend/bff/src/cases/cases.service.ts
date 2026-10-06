import { Injectable, NotFoundException } from '@nestjs/common';
import type { Case } from '@prisma/client';
import { FoldersService } from '../folders/folders.service';
import { PrismaService } from '../prisma/prisma.service';
import { STABLE_ORDER, finishPage, pageArgs, prismaPage, type Page, type PageQueryDto } from '../common/pagination';

export type { Case };

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folders: FoldersService,
  ) {}

  async create(body: {
    tenantId: string;
    title: string;
    ownerId?: string;
    folderId?: string | null;
    loose?: boolean;
  }): Promise<Case> {
    if (body.folderId && body.ownerId) {
      await this.folders.assertOwned(body.folderId, { tenantId: body.tenantId, ownerId: body.ownerId });
    }
    return this.prisma.case.create({
      data: {
        tenantId: body.tenantId,
        title: body.title,
        ownerId: body.ownerId,
        folderId: body.folderId ?? null,
        loose: body.loose ?? false,
      },
    });
  }

  /** Renombra o mueve un expediente propio (o anterior a las carpetas, sin dueño). */
  async update(
    id: string,
    patch: { title?: string; folderId?: string | null },
    actor: { tenantId: string; ownerId: string },
  ): Promise<Case> {
    const kase = await this.prisma.case.findFirst({
      where: { id, tenantId: actor.tenantId, OR: [{ ownerId: actor.ownerId }, { ownerId: null }] },
    });
    if (!kase) throw new NotFoundException(`Caso ${id} no encontrado`);
    if (patch.folderId) await this.folders.assertOwned(patch.folderId, actor);
    return this.prisma.case.update({
      where: { id },
      data: {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
        ownerId: actor.ownerId,
      },
    });
  }

  async list(tenantId?: string, page?: PageQueryDto): Promise<Case[] | Page<Case>> {
    const args = pageArgs(page);
    const rows = await this.prisma.case.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: STABLE_ORDER,
      ...prismaPage(args),
    });
    return finishPage(rows, args);
  }

  /** Carga en lote (una sola consulta) para evitar N+1 en la bandeja. */
  async findManyByIds(ids: string[], tenantId?: string): Promise<Map<string, Case>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.case.findMany({
      where: { id: { in: [...new Set(ids)] }, ...(tenantId ? { tenantId } : {}) },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  find(id: string, tenantId?: string): Promise<Case | null> {
    return this.prisma.case.findFirst({ where: { id, ...(tenantId ? { tenantId } : {}) } });
  }

  async getOrThrow(id: string, tenantId?: string): Promise<Case> {
    const found = await this.find(id, tenantId);
    if (!found) throw new NotFoundException(`Caso ${id} no encontrado`);
    return found;
  }
}
