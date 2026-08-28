import { Injectable, NotFoundException } from '@nestjs/common';
import type { Case } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type { Case };

@Injectable()
export class CasesService {
  constructor(private readonly prisma: PrismaService) {}

  create(body: { tenantId: string; title: string }): Promise<Case> {
    return this.prisma.case.create({
      data: { tenantId: body.tenantId, title: body.title },
    });
  }

  list(tenantId?: string): Promise<Case[]> {
    return this.prisma.case.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  find(id: string): Promise<Case | null> {
    return this.prisma.case.findUnique({ where: { id } });
  }

  async getOrThrow(id: string): Promise<Case> {
    const found = await this.find(id);
    if (!found) throw new NotFoundException(`Caso ${id} no encontrado`);
    return found;
  }
}
