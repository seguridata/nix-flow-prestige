import { NotFoundException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsService, sha256Hex } from './documents.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { CollaborationService } from '../collaboration/collaboration.service';

type Row = {
  id: string;
  caseId: string;
  tenantId: string;
  filename: string;
  version: number;
  hash: string;
  locked: boolean;
  frozenAt: Date | null;
  presentedObjectKey: string | null;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
  objectKey: string;
  enc: object;
};

const auditSpy = vi.fn(async () => undefined);

function makeService(opts: { docs: Record<string, Row>; bytesByKey: Record<string, Buffer> }) {
  const { docs, bytesByKey } = opts;

  const prisma = {
    document: {
      findFirst: async ({ where }: { where: { id: string; tenantId?: string } }) => {
        const row = docs[where.id];
        if (!row) return null;
        if (where.tenantId && row.tenantId !== where.tenantId) return null;
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        docs[where.id] = { ...docs[where.id], ...data };
        return docs[where.id];
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; tenantId?: string; locked?: boolean };
        data: Partial<Row>;
      }) => {
        const row = docs[where.id];
        if (!row) return { count: 0 };
        if (where.tenantId && row.tenantId !== where.tenantId) return { count: 0 };
        if (where.locked !== undefined && row.locked !== where.locked) return { count: 0 };
        docs[where.id] = { ...row, ...data };
        return { count: 1 };
      },
      findMany: async ({ where }: { where: { tenantId: string; caseId?: string } }) =>
        Object.values(docs)
          .filter((d) => d.tenantId === where.tenantId && (!where.caseId || d.caseId === where.caseId))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    },
  } as unknown as PrismaService;

  const storage = {
    putObject: async ({ bytes }: { bytes: Buffer }) => ({
      objectKey: `new-${bytes.length}`,
      enc: {},
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.length,
    }),
    getObject: async (objectKey: string) => {
      const bytes = bytesByKey[objectKey];
      if (!bytes) throw new Error(`objeto de prueba no configurado: ${objectKey}`);
      return bytes;
    },
  } as unknown as StorageService;

  const collab = { audit: auditSpy } as unknown as CollaborationService;

  return new DocumentsService(prisma, storage, collab);
}

function row(overrides: Partial<Row> & { id: string; hash: string; objectKey: string }): Row {
  return {
    caseId: 'case-1',
    tenantId: 'seguridata',
    filename: 'contrato.pdf',
    version: 1,
    locked: false,
    frozenAt: null,
    presentedObjectKey: null,
    sizeBytes: 100,
    mimeType: 'application/pdf',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    enc: {},
    ...overrides,
  };
}

describe('DocumentsService — freeze e integridad', () => {
  it('freeze congela el documento y deja el canónico intacto', async () => {
    const bytes = Buffer.from('%PDF-1.4 contenido original');
    const hash = sha256Hex(bytes);
    const docs = { 'doc-1': row({ id: 'doc-1', hash, objectKey: 'k1' }) };
    const svc = makeService({ docs, bytesByKey: { k1: bytes } });

    const frozen = await svc.freeze('doc-1', 'seguridata', 'actor-1');
    expect(frozen.locked).toBe(true);
    expect(frozen.frozenAt).not.toBeNull();
    expect(docs['doc-1'].locked).toBe(true);
    expect(docs['doc-1'].hash).toBe(hash);
    // Ya no existe ninguna vía de reemplazo del canónico en el servicio.
    expect((svc as unknown as Record<string, unknown>).replaceContent).toBeUndefined();
  });

  it('dos freeze concurrentes congelan y auditan una sola vez (updateMany locked:false)', async () => {
    auditSpy.mockClear();
    const bytes = Buffer.from('%PDF-1.4 carrera');
    const docs = { 'doc-1': row({ id: 'doc-1', hash: sha256Hex(bytes), objectKey: 'k1' }) };
    const svc = makeService({ docs, bytesByKey: { k1: bytes } });

    const [a, b] = await Promise.all([
      svc.freeze('doc-1', 'seguridata', 'actor-1'),
      svc.freeze('doc-1', 'seguridata', 'actor-2'),
    ]);
    expect(a.locked).toBe(true);
    expect(b.locked).toBe(true);
    expect(auditSpy).toHaveBeenCalledTimes(1);
  });

  it('freeze es idempotente: un segundo freeze sobre un documento ya congelado no vuelve a escribir', async () => {
    const bytes = Buffer.from('%PDF-1.4 contenido');
    const hash = sha256Hex(bytes);
    const frozenAt = new Date('2026-02-02T00:00:00.000Z');
    const docs = { 'doc-1': row({ id: 'doc-1', hash, objectKey: 'k1', locked: true, frozenAt }) };
    const svc = makeService({ docs, bytesByKey: { k1: bytes } });

    const result = await svc.freeze('doc-1', 'seguridata', 'actor-1');
    expect(result.frozenAt).toEqual(frozenAt);
  });

  it('freeze responde 409 HASH_MISMATCH si el objeto en storage no coincide con el hash registrado', async () => {
    const registeredHash = sha256Hex(Buffer.from('bytes esperados'));
    const docs = { 'doc-1': row({ id: 'doc-1', hash: registeredHash, objectKey: 'k1' }) };
    // El storage devuelve bytes distintos a los que el hash registrado describe.
    const svc = makeService({ docs, bytesByKey: { k1: Buffer.from('bytes distintos') } });

    try {
      await svc.freeze('doc-1', 'seguridata', 'actor-1');
      expect.unreachable('freeze debía rechazar el hash mismatch');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      expect((e as ConflictException).getStatus()).toBe(409);
      expect((e as ConflictException).getResponse()).toMatchObject({ error: 'HASH_MISMATCH' });
    }
    expect(docs['doc-1'].locked).toBe(false);
  });
});

describe('DocumentsService — aislamiento por tenant', () => {
  it('el tenant B no puede leer ni congelar un documento del tenant A (404)', async () => {
    const bytes = Buffer.from('%PDF-1.4 confidencial de A');
    const hash = sha256Hex(bytes);
    const docs = { 'doc-a': row({ id: 'doc-a', hash, objectKey: 'k1', tenantId: 'tenant-a' }) };
    const svc = makeService({ docs, bytesByKey: { k1: bytes } });

    await expect(svc.get('doc-a', 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.freeze('doc-a', 'tenant-b', 'actor-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getContent('doc-a', 'tenant-b')).rejects.toBeInstanceOf(NotFoundException);

    // El dueño real sigue pudiendo leerlo.
    const own = await svc.get('doc-a', 'tenant-a');
    expect(own.id).toBe('doc-a');
  });

  it('find devuelve null (no 500) cuando no hay tenantId, y la lista nunca mezcla tenants', async () => {
    const bytesA = Buffer.from('%PDF-1.4 A');
    const bytesB = Buffer.from('%PDF-1.4 B');
    const docs = {
      'doc-a': row({ id: 'doc-a', hash: sha256Hex(bytesA), objectKey: 'ka', tenantId: 'tenant-a' }),
    };
    const svc = makeService({ docs, bytesByKey: { ka: bytesA, kb: bytesB } });

    expect(await svc.find('doc-a', undefined)).toBeNull();
    const list = await svc.list(undefined, 'tenant-b');
    expect(list).toEqual([]);
  });
});
