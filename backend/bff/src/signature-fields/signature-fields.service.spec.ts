import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import { SignatureFieldsController } from './signature-fields.controller';
import { SignatureFieldsService, type SignatureFieldInput } from './signature-fields.service';

type Field = { id: string; tenantId: string | null; documentId: string } & Record<string, unknown>;

function makeService() {
  const docs: Record<string, { id: string; tenantId: string }> = {
    'doc-a': { id: 'doc-a', tenantId: 'tenant-a' },
    'doc-b': { id: 'doc-b', tenantId: 'tenant-b' },
  };
  const fields: Field[] = [];
  let seq = 0;
  const prisma = {
    document: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
        const d = docs[where.id];
        return d && d.tenantId === where.tenantId ? { id: d.id } : null;
      },
    },
    signatureField: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `f-${++seq}`, ...data } as Field;
        fields.push(row);
        return row;
      },
      findMany: async ({ where }: { where: { documentId: string } }) =>
        fields.filter((f) => f.documentId === where.documentId),
      findFirst: async ({ where }: { where: { id: string; document: { tenantId: string } } }) =>
        fields.find((f) => f.id === where.id && docs[f.documentId]?.tenantId === where.document.tenantId) ?? null,
      deleteMany: async ({
        where,
      }: {
        where: { id?: string; documentId?: string; document?: { tenantId: string } };
      }) => {
        let count = 0;
        for (let i = fields.length - 1; i >= 0; i--) {
          const f = fields[i];
          if (where.id && f.id !== where.id) continue;
          if (where.documentId && f.documentId !== where.documentId) continue;
          if (where.document && docs[f.documentId]?.tenantId !== where.document.tenantId) continue;
          fields.splice(i, 1);
          count++;
        }
        return { count };
      },
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const d of data) fields.push({ id: `f-${++seq}`, ...d } as Field);
        return { count: data.length };
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(prisma),
  } as unknown as PrismaService;
  return { svc: new SignatureFieldsService(prisma), fields };
}

const input = (documentId: string, over: Partial<SignatureFieldInput> = {}): SignatureFieldInput => ({
  documentId,
  signerId: 'ana',
  type: 'SIGNATURE',
  page: 1,
  xPct: 0.1,
  yPct: 0.1,
  widthPct: 0.2,
  heightPct: 0.1,
  ...over,
});

describe('SignatureFieldsService - aislamiento por tenant', () => {
  it('create guarda el tenantId del usuario y 404 si el documento es de otro tenant', async () => {
    const { svc, fields } = makeService();
    const created = await svc.create(input('doc-a'), 'tenant-a');
    expect(created).toMatchObject({ tenantId: 'tenant-a', documentId: 'doc-a' });
    await expect(svc.create(input('doc-a'), 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(fields).toHaveLength(1);
  });

  it('list responde 404 para un documento ajeno y devuelve los campos al dueño', async () => {
    const { svc } = makeService();
    await svc.create(input('doc-a'), 'tenant-a');
    await expect(svc.listByDocument('doc-a', 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(await svc.listByDocument('doc-a', 'tenant-a')).toHaveLength(1);
  });

  it('remove: el tenant B no puede borrar un campo del tenant A (404) y el campo sobrevive', async () => {
    const { svc, fields } = makeService();
    const f = await svc.create(input('doc-a'), 'tenant-a');
    await expect(svc.remove(f.id, 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(fields).toHaveLength(1);
    await expect(svc.remove(f.id, 'tenant-a')).resolves.toEqual({ id: f.id });
    expect(fields).toHaveLength(0);
  });

  it('remove alcanza campos legados con tenantId nulo via su documento', async () => {
    const { svc, fields } = makeService();
    fields.push({ id: 'legacy', tenantId: null, documentId: 'doc-a' });
    await expect(svc.remove('legacy', 'tenant-a')).resolves.toEqual({ id: 'legacy' });
  });

  it('createMany contra un documento ajeno responde 404 y NO borra sus campos', async () => {
    const { svc, fields } = makeService();
    await svc.createMany('doc-a', [input('doc-a'), input('doc-a', { page: 2 })], 'tenant-a');
    expect(fields).toHaveLength(2);
    await expect(svc.createMany('doc-a', [], 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.createMany('doc-a', [input('doc-a')], 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(fields).toHaveLength(2);
  });

  it('createMany del dueño reemplaza el conjunto y guarda tenantId en cada campo', async () => {
    const { svc, fields } = makeService();
    await svc.createMany('doc-a', [input('doc-a'), input('doc-a', { page: 2 })], 'tenant-a');
    const result = await svc.createMany('doc-a', [input('doc-a', { signerId: 'beto' })], 'tenant-a');
    expect(result).toHaveLength(1);
    expect(fields.every((f) => f.tenantId === 'tenant-a')).toBe(true);
  });

  it('createMany no permite mezclar documentId distintos ni coordenadas invalidas', async () => {
    const { svc } = makeService();
    await expect(svc.createMany('doc-a', [input('doc-b')], 'tenant-a')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createMany('doc-a', [input('doc-a', { xPct: 2 })], 'tenant-a')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SignatureFieldsController - roles', () => {
  it('create, bulk y remove exigen sender/admin', () => {
    const proto = SignatureFieldsController.prototype;
    for (const name of ['create', 'bulk', 'remove'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, proto[name])).toEqual(['sender', 'admin']);
    }
  });
});
