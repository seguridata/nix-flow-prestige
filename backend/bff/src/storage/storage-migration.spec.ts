import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { migrateStorageObject, needsStorageMigration, type MigrationObject } from './storage-migration';
import type { StorageService } from './storage.service';

const bytes = Buffer.from('PDF firmado: los bytes deben conservarse');
const hash = createHash('sha256').update(bytes).digest('hex');
const ref: MigrationObject = { key: 'documents/2026-01-01/old.pdf', tenantId: 'acme', prefix: 'documents', hash,
  enc: { v: 1, alg: 'AES-256-GCM', iv: 'iv', tag: 'tag', dek: { wrapped: 'w', iv: 'iv', tag: 'tag' } } };

describe('backfill de referencias de storage', () => {
  it('identifica claves antiguas y metadatos sin AAD; omite referencias ya migradas', () => {
    expect(needsStorageMigration(ref)).toBe(true);
    expect(needsStorageMigration({ ...ref, key: 'documents/acme/old.pdf' })).toBe(true);
    expect(needsStorageMigration({ ...ref, key: 'documents/acme/old.pdf', enc: { ...ref.enc, aad: 'tenant' } })).toBe(false);
    expect(() => needsStorageMigration({ ...ref, tenantId: '' })).toThrow();
  });
  it('un hash de origen incorrecto impide subir un objeto nuevo', async () => {
    const storage = { getObject: vi.fn().mockResolvedValue(Buffer.from('manipulado')), putObject: vi.fn() };
    await expect(migrateStorageObject(storage as unknown as StorageService, ref)).rejects.toThrow(/Hash de origen/);
    expect(storage.putObject).not.toHaveBeenCalled();
  });
  it('relee destino y conserva el original; nunca cambia bytes firmados', async () => {
    const stored = { objectKey: 'documents/acme/new.pdf', enc: { ...ref.enc, aad: 'tenant' }, sha256: hash, sizeBytes: bytes.length };
    const storage = { getObject: vi.fn().mockResolvedValue(bytes), putObject: vi.fn().mockResolvedValue(stored), deleteObject: vi.fn() };
    expect(await migrateStorageObject(storage as unknown as StorageService, ref)).toEqual(stored);
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'acme', bytes, prefix: 'documents/acme' }));
    expect(storage.getObject).toHaveBeenLastCalledWith(stored.objectKey, stored.enc, 'acme');
    expect(storage.deleteObject).not.toHaveBeenCalled();
    storage.getObject.mockResolvedValueOnce(bytes).mockResolvedValueOnce(Buffer.from('destino corrupto'));
    await expect(migrateStorageObject(storage as unknown as StorageService, ref)).rejects.toThrow(/destino/);
  });
});
