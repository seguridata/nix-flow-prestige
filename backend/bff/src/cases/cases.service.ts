import { Injectable, NotFoundException } from '@nestjs/common';
import type { Case } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STABLE_ORDER, finishPage, pageArgs, prismaPage, type Page, type PageQueryDto } from '../common/pagination';

export type { Case };

@Injectable()
export class CasesService {
  constructor(private readonly prisma: PrismaService) {}

  create(body: { tenantId: string; title: string }): Promise<Case> {
    return this.prisma.case.create({
      data: { tenantId: body.tenantId, title: body.title },
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
