/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FoldersService } from './folders.service';

const me = { tenantId: 'T', ownerId: 'maria' };

type Row = { id: string; tenantId: string; ownerId: string; parentId: string | null; name: string };

/** Prisma en memoria mínimo: lo justo para ejercitar las reglas del árbol. */
function svc(rows: Row[], cases: { folderId: string | null }[] = []) {
  const prisma = {
    folder: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          rows.find((r) => {
            if (where.id && typeof where.id === 'string' && r.id !== where.id) return false;
            if (where.id?.not && r.id === where.id.not) return false;
            if (where.tenantId && r.tenantId !== where.tenantId) return false;
            if (where.ownerId && r.ownerId !== where.ownerId) return false;
            if ('parentId' in where && r.parentId !== where.parentId) return false;
            if (where.name?.equals && r.name.toLowerCase() !== where.name.equals.toLowerCase()) return false;
            return true;
          }) ?? null
        );
      }),
      count: vi.fn(async ({ where }: any) => rows.filter((r) => r.parentId === where.parentId).length),
      create: vi.fn(async ({ data }: any) => ({ id: 'new', ...data })),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      delete: vi.fn(async () => undefined),
    },
    case: { count: vi.fn(async ({ where }: any) => cases.filter((c) => c.folderId === where.folderId).length) },
  };
  return { s: new FoldersService(prisma as any), prisma };
}

const tree: Row[] = [
  { id: 'a', tenantId: 'T', ownerId: 'maria', parentId: null, name: 'RH' },
  { id: 'b', tenantId: 'T', ownerId: 'maria', parentId: 'a', name: 'Vacaciones' },
  { id: 'c', tenantId: 'T', ownerId: 'maria', parentId: 'b', name: '2026' },
  { id: 'x', tenantId: 'T', ownerId: 'carlos', parentId: null, name: 'Ajena' },
];

describe('carpetas personales', () => {
  it('no se mueve una carpeta dentro de sí misma ni de sus descendientes', async () => {
    const { s } = svc(tree);
    await expect(s.update('a', { parentId: 'c' }, me)).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.update('a', { parentId: 'a' }, me)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('una carpeta ajena responde 404, no 403 (no revela que existe)', async () => {
    const { s } = svc(tree);
    await expect(s.update('x', { name: 'Mía' }, me)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.create('Nueva', 'x', me)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza nombres repetidos en el mismo nivel sin distinguir mayúsculas', async () => {
    const { s } = svc(tree);
    await expect(s.create('rh', null, me)).rejects.toBeInstanceOf(ConflictException);
  });

  it('permite el mismo nombre en otro nivel', async () => {
    const { s, prisma } = svc(tree);
    await s.create('RH', 'b', me);
    expect(prisma.folder.create).toHaveBeenCalled();
  });

  it('no borra carpetas con contenido', async () => {
    const { s } = svc(tree, [{ folderId: 'c' }]);
    await expect(s.remove('a', me)).rejects.toBeInstanceOf(ConflictException); // tiene subcarpeta
    await expect(s.remove('c', me)).rejects.toBeInstanceOf(ConflictException); // tiene un expediente
  });

  it('borra una carpeta vacía', async () => {
    const { s, prisma } = svc(tree);
    await s.remove('c', me);
    expect(prisma.folder.delete).toHaveBeenCalledWith({ where: { id: 'c', tenantId: 'T' } });
  });

  it('rechaza nombres vacíos', async () => {
    const { s } = svc(tree);
    await expect(s.create('   ', null, me)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('contents: paginación de expedientes', () => {
  const mkCase = (id: string) => ({
    id,
    title: id,
    status: 'ABIERTO',
    loose: false,
    createdAt: new Date(),
    _count: { documents: 0 },
    documents: [],
  });
  function contentsSvc(all: string[]) {
    const caseFindMany = vi.fn(async (args: any) => {
      let ids = [...all];
      if (args.cursor) ids = ids.slice(ids.indexOf(args.cursor.id) + (args.skip ?? 0));
      return ids.slice(0, args.take).map(mkCase);
    });
    const prisma = { folder: { findMany: vi.fn(async () => []) }, case: { findMany: caseFindMany } };
    return { s: new FoldersService(prisma as any), caseFindMany };
  }

  it('sin limit/cursor conserva el tope legado de 500 (pide 501 para detectar más)', async () => {
    const { s, caseFindMany } = contentsSvc(['c1', 'c2']);
    const r = await s.contents(null, me);
    expect(caseFindMany.mock.calls[0][0].take).toBe(501);
    expect(r.cases.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(r.nextCursor).toBeNull();
  });

  it('con limit devuelve nextCursor y la siguiente página continúa', async () => {
    const { s } = contentsSvc(['c1', 'c2', 'c3']);
    const p1 = await s.contents(null, me, { limit: 2 });
    expect(p1.cases.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(p1.nextCursor).toBe('c2');
    const p2 = await s.contents(null, me, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.cases.map((c) => c.id)).toEqual(['c3']);
    expect(p2.nextCursor).toBeNull();
  });
});
