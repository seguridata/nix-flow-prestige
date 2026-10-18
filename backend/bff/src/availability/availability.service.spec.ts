import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import type { PrismaService } from '../prisma/prisma.service';

type Key = { tenantId: string; userId: string };
type Row = Key & { id: string; delegateId: string; [k: string]: unknown };
type UniqueWhere = { tenantId_userId: Key };

/** Tabla en memoria que respeta la unicidad (tenantId, userId) como la BD. */
function fakePrisma() {
  const rows: Row[] = [];
  let n = 0;
  const find = (k: Key) => rows.find((r) => r.tenantId === k.tenantId && r.userId === k.userId) ?? null;
  const outOfOffice = {
    findUnique: async ({ where }: { where: UniqueWhere }) => find(where.tenantId_userId),
    upsert: async ({ where, create, update }: { where: UniqueWhere; create: Omit<Row, 'id'>; update: object }) => {
      const hit = find(where.tenantId_userId);
      if (hit) return Object.assign(hit, update);
      if (find(create)) throw new Error('Unique constraint (tenantId, userId)');
      const row = { id: `r${(n += 1)}`, ...create } as Row;
      rows.push(row);
      return row;
    },
    deleteMany: async ({ where }: { where: Key }) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].tenantId === where.tenantId && rows[i].userId === where.userId) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    },
  };
  return { rows, svc: new AvailabilityService({ outOfOffice } as unknown as PrismaService) };
}

describe('AvailabilityService - OutOfOffice único por (tenantId, userId)', () => {
  it('el mismo usuario puede tener una regla distinta en cada tenant', async () => {
    const { svc, rows } = fakePrisma();
    await svc.set({ tenantId: 'A', userId: 'maria', delegateId: 'carlos' });
    await svc.set({ tenantId: 'B', userId: 'maria', delegateId: 'luis' });
    expect(rows).toHaveLength(2);
    expect((await svc.get('A', 'maria'))?.delegateId).toBe('carlos');
    expect((await svc.get('B', 'maria'))?.delegateId).toBe('luis');
  });

  it('set en el mismo tenant actualiza, no duplica', async () => {
    const { svc, rows } = fakePrisma();
    await svc.set({ tenantId: 'A', userId: 'maria', delegateId: 'carlos' });
    await svc.set({ tenantId: 'A', userId: 'maria', delegateId: 'luis' });
    expect(rows).toHaveLength(1);
    expect(rows[0].delegateId).toBe('luis');
  });

  it('un tenant no lee ni borra la regla de otro', async () => {
    const { svc } = fakePrisma();
    await svc.set({ tenantId: 'A', userId: 'maria', delegateId: 'carlos' });
    expect(await svc.get('B', 'maria')).toBeNull();
    await svc.clear('B', 'maria');
    expect((await svc.get('A', 'maria'))?.delegateId).toBe('carlos');
    await svc.clear('A', 'maria');
    expect(await svc.get('A', 'maria')).toBeNull();
  });

  it('rechaza suplente igual al usuario', async () => {
    const { svc } = fakePrisma();
    await expect(svc.set({ tenantId: 'A', userId: 'm', delegateId: 'm' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
