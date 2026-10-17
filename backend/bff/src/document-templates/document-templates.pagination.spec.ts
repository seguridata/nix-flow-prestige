/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DocumentTemplatesService } from './document-templates.service';
import { DocumentTemplatesController } from './document-templates.controller';
import type { TemplateActor } from './template.types';

const actor: TemplateActor = { tenantId: 'A', actorId: 'persona', isAdmin: false };
function setup(count = 235) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: `id-${String(i).padStart(4, '0')}`, tenantId: 'A', name: `Grupo ${Math.floor(i / 3)}`, published: true,
    description: null, category: null, fields: [], flow: { steps: [] }, attachmentSpecs: [], kind: 'FORM', flowKey: null, flowVersion: null }));
  rows.push({ ...rows[0], id: 'draft', tenantId: 'A', name: 'Borrador', published: false });
  rows.push({ ...rows[0], id: 'foreign', tenantId: 'B', name: 'Ajeno' });
  const matches = (row: any, where: any) => row.tenantId === where.tenantId && (!where.id || row.id === where.id) && (where.published === undefined || row.published === where.published);
  const prisma = { documentTemplate: {
    findFirst: vi.fn(async ({ where }: any) => rows.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where, cursor, take, skip }: any) => {
      const visible = rows.filter((row) => matches(row, where)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const start = cursor ? visible.findIndex((row) => row.id === cursor.id) + skip : 0;
      return visible.slice(start, take === undefined ? undefined : start + take);
    }),
  } };
  const service = new DocumentTemplatesService(prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { service, prisma, rows };
}

describe('Formatos: paginación por nombre e id', () => {
  it('recorre más de200 registros incluso con nombres repetidos sin perder ni repetir ids', async () => {
    const { service, prisma } = setup();
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.list(actor, true, { limit: 50, cursor });
      if (Array.isArray(page)) throw new Error('Se esperaba una página');
      ids.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(235);
    expect(new Set(ids).size).toBe(235);
    expect(ids).not.toContain('draft');
    expect(ids).not.toContain('foreign');
    expect(prisma.documentTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 51 }));
  });

  it('conserva el array completo sin parámetros y admin puede incluir borradores', async () => {
    const { service } = setup();
    expect(await service.list(actor, false)).toHaveLength(235);
    expect(await service.list({ ...actor, isAdmin: true }, true)).toHaveLength(236);
  });

  it('rechaza cursores ajenos, borradores ocultos y anclas eliminadas antes de listar', async () => {
    const { service, prisma } = setup();
    for (const cursor of ['foreign', 'draft', 'missing']) {
      await expect(service.list(actor, true, { limit: 50, cursor })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.documentTemplate.findMany).not.toHaveBeenCalled();
    expect(prisma.documentTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'A', published: true, id: 'foreign' } }));
  });

  it('vacío devuelve página final y no revela contenido de configuración en los resúmenes', async () => {
    const { service } = setup(0);
    const page = await service.list(actor, false, { limit: 50 });
    expect(page).toEqual({ items: [], nextCursor: null });
    const { service: populated } = setup(1);
    const result = await populated.list(actor, false, { limit: 50 });
    expect(JSON.stringify(result)).not.toContain('attachmentSpecs');
    expect(JSON.stringify(result)).not.toContain('"flow":');
  });

  it('controller transmite paginación y actor autenticado sin aceptar tenant del cliente', async () => {
    const list = vi.fn();
    const controller = new DocumentTemplatesController({ list } as any);
    controller.list({ limit: 25, cursor: 'id-1', all: 'true' }, { tenantId: 'A', actorId: 'persona', roles: ['sender'] } as any);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', actorId: 'persona', isAdmin: false }), true, { limit: 25, cursor: 'id-1', all: 'true' });
  });
});
