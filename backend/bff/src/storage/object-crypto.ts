import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Cifrado en reposo de objetos — *envelope encryption* real (D2 del HANDOFF).
 *
 * Cada objeto se cifra con una llave de datos (DEK) única de 256 bits en
 * AES-256-GCM. La DEK se envuelve, a su vez, con la llave maestra
 * (`STORAGE_MASTER_KEY`, base64 de 32 bytes) también en AES-256-GCM. La llave
 * maestra nunca se persiste; en producción se conmuta a un KMS/HSM cambiando
 * únicamente `wrapKey` / `unwrapKey`.
 *
 * `EncMeta` es lo que se guarda junto al `objectKey` en la base de datos: no
 * contiene ningún material que sirva para descifrar sin la llave maestra.
 */
export interface EncMeta {
  v: 1;
  alg: 'AES-256-GCM';
  iv: string; // base64 — IV del contenido
  tag: string; // base64 — auth tag del contenido
  dek: {
    wrapped: string; // base64 — DEK cifrada con la llave maestra
    iv: string; // base64 — IV usado para envolver la DEK
    tag: string; // base64 — auth tag del envoltorio
  };
}

const ALG = 'aes-256-gcm';

function masterKey(): Buffer {
  const raw = process.env.STORAGE_MASTER_KEY?.trim();
  if (!raw) {
    throw new Error(
      'STORAGE_MASTER_KEY no está configurada. Genera una con `bun run gen-keys` y colócala en backend/bff/.env',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('STORAGE_MASTER_KEY debe ser base64 de exactamente 32 bytes (256 bits)');
  }
  return key;
}

function wrapKey(dek: Buffer): { wrapped: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, masterKey(), iv);
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    wrapped: wrapped.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function unwrapKey(meta: EncMeta['dek']): Buffer {
  const decipher = createDecipheriv(ALG, masterKey(), Buffer.from(meta.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(meta.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(meta.wrapped, 'base64')), decipher.final()]);
}

export function encryptObject(plaintext: Buffer): { ciphertext: Buffer; enc: EncMeta } {
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext,
    enc: {
      v: 1,
      alg: 'AES-256-GCM',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      dek: wrapKey(dek),
    },
  };
}

export function decryptObject(ciphertext: Buffer, enc: EncMeta): Buffer {
  if (enc?.alg !== 'AES-256-GCM') {
    throw new Error(`Algoritmo de cifrado no soportado: ${enc?.alg}`);
  }
  const dek = unwrapKey(enc.dek);
  const decipher = createDecipheriv(ALG, dek, Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function isEncMeta(value: unknown): value is EncMeta {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return m.alg === 'AES-256-GCM' && typeof m.iv === 'string' && typeof m.tag === 'string' && !!m.dek;
}
