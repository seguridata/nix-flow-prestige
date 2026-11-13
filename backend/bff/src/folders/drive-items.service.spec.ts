/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DriveItemsService } from './drive-items.service';

const me = { tenantId: 'T', ownerId: 'maria' };

function build(opts: { found?: boolean; requests?: number } = {}) {
  const kase = {
    id: 'c1',
    title: 'Contrato',
    loose: true,
    documents: [
      { id: 'd1', filename: 'a.pdf', objectKey: 'T/a', presentedObjectKey: null, attachmentKey: null },
      { id: 'd2', filename: 'anexo.pdf', objectKey: 'T/b', presentedObjectKey: null, attachmentKey: 'cot' },
    ],
  };
  const prisma: any = {
    case: {
      findFirst: vi.fn(async () => (opts.found === false ? null : kase)),
      create: vi.fn(async ({ data }: any) => ({ id: 'c2', ...data })),
      delete: vi.fn(async () => undefined),
    },
    signatureRequest: { count: vi.fn(async () => opts.requests ?? 0) },
    evidenceManifest: { count: vi.fn(async () => 0) },
    documentComment: { count: vi.fn(async () => 0) },
    signatureField: { deleteMany: vi.fn(async () => undefined) },
    document: { deleteMany: vi.fn(async () => undefined) },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  };
  const storage: any = { deleteObject: vi.fn(async () => undefined) };
  const documents: any = {
    getContent: vi.fn(async () => ({ bytes: Buffer.from('%PDF-1'), filename: 'a.pdf' })),
    create: vi.fn(async () => ({})),
  };
  const folders: any = { assertOwned: vi.fn(async () => undefined) };
  return { s: new DriveItemsService(prisma, storage, documents, folders), prisma, storage, documents, folders };
}

describe('eliminar expedientes', () => {
  it('borra un borrador y retira sus objetos cifrados', async () => {
    const { s, prisma, storage } = build();
    await s.removeCase('c1', me);
    expect(prisma.case.delete).toHaveBeenCalled();
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
  });

  it('con solicitud de firma responde 409 y no borra nada', async () => {
    const { s, prisma, storage } = build({ requests: 1 });
    await expect(s.removeCase('c1', me)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('un expediente ajeno responde 404', async () => {
    const { s } = build({ found: false });
    await expect(s.removeCase('x', me)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('copiar expedientes', () => {
  it('copia solo los documentos principales (no los anexos) a la carpeta destino', async () => {
    const { s, documents, folders, prisma } = build();
    const copy = await s.copyCase('c1', 'f1', me);
    expect(folders.assertOwned).toHaveBeenCalledWith('f1', me);
    expect(prisma.case.create.mock.calls[0][0].data).toMatchObject({ title: 'Contrato (copia)', folderId: 'f1', ownerId: 'maria', loose: true });
    expect(documents.create).toHaveBeenCalledTimes(1);
    expect(copy.id).toBe('c2');
  });
});
