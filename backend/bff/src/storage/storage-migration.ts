import { createHash } from 'node:crypto';
import { isEncMeta, type EncMeta } from './object-crypto';
import type { StorageService } from './storage.service';

export interface MigrationObject {
  key: string;
  enc: EncMeta;
  hash: string;
  tenantId: string;
  prefix: 'documents' | 'presented' | 'templates' | 'onboarding';
}

export function needsStorageMigration(ref: MigrationObject): boolean {
  if (!ref.tenantId || !/^[^/\\]+$/.test(ref.tenantId) || !isEncMeta(ref.enc)) {
    throw new Error('Referencia de storage incompleta o tenant inválido');
  }
  const parts = ref.key.split('/');
  if (parts.length < 3 || parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Clave de storage mal formada');
  if (!['documents', 'presented', 'templates', 'onboarding', 'legacy'].includes(parts[0])) throw new Error('Prefijo de storage desconocido');
  return ref.enc.aad !== 'tenant' || parts[1] !== ref.tenantId;
}

/** Conserva bytes y hash canónicos, incluidos PDFs firmados. No elimina el original. */
export async function migrateStorageObject(storage: StorageService, ref: MigrationObject) {
  const bytes = await storage.getObject(ref.key, ref.enc, ref.tenantId);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (!ref.hash || hash !== ref.hash) throw new Error('Hash de origen incorrecto; migración cancelada');
  const stored = await storage.putObject({
    prefix: `${ref.prefix}/${ref.tenantId}`, filename: ref.key.split('/').pop() || 'objeto',
    bytes, contentType: 'application/octet-stream', tenantId: ref.tenantId,
  });
  const verified = await storage.getObject(stored.objectKey, stored.enc, ref.tenantId);
  if (createHash('sha256').update(verified).digest('hex') !== hash) {
    throw new Error('Verificación de destino fallida; se conserva la referencia original');
  }
  return stored;
}
