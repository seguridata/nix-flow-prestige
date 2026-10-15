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
    /** Identificador de la llave maestra que envolvió la DEK. Ausente = 'v1' (objetos antiguos). */
    kid?: string;
  };
  /**
   * Si es 'tenant', el contenido se cifró con el tenant como AAD de GCM y hay
   * que pasar el mismo `tenantId` al descifrar. Ausente = objeto antiguo sin AAD.
   */
  aad?: 'tenant';
}

/** kid de la llave maestra por defecto (`STORAGE_MASTER_KEY`). */
export const DEFAULT_KID = 'v1';

const ALG = 'aes-256-gcm';

function kidEnvName(kid: string): string {
  if (!/^[A-Za-z0-9_]{1,32}$/.test(kid)) {
    throw new Error(`Identificador de llave maestra inválido: ${JSON.stringify(kid)}`);
  }
  return kid === DEFAULT_KID ? 'STORAGE_MASTER_KEY' : `STORAGE_MASTER_KEY_${kid.toUpperCase()}`;
}

/**
 * Llave maestra por kid. `v1` = `STORAGE_MASTER_KEY`; para rotar se añaden
 * `STORAGE_MASTER_KEY_<KID>` (p. ej. `STORAGE_MASTER_KEY_V2`) y se elige la
 * activa con `STORAGE_ACTIVE_KID`. Las llaves viejas se conservan para descifrar.
 */
function masterKey(kid: string = DEFAULT_KID): Buffer {
  const name = kidEnvName(kid);
  const raw = process.env[name]?.trim();
  if (!raw) {
    throw new Error(
      `${name} no está configurada. Genera una con \`bun run gen-keys\` y colócala en backend/bff/.env`,
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`${name} debe ser base64 de exactamente 32 bytes (256 bits)`);
  }
  return key;
}

function activeKid(): string {
  return process.env.STORAGE_ACTIVE_KID?.trim() || DEFAULT_KID;
}

function wrapKey(dek: Buffer, kid: string): EncMeta['dek'] {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, masterKey(kid), iv);
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    wrapped: wrapped.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    kid,
  };
}

function unwrapKey(meta: EncMeta['dek']): Buffer {
  const decipher = createDecipheriv(ALG, masterKey(meta.kid ?? DEFAULT_KID), Buffer.from(meta.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(meta.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(meta.wrapped, 'base64')), decipher.final()]);
}

function tenantAad(tenantId: string): Buffer {
  return Buffer.from(`prestige:tenant:${tenantId}`, 'utf8');
}

export interface EncryptOptions {
  /** Si se da, el tenant se liga al contenido como AAD (objeto nuevo con `aad: 'tenant'`). */
  tenantId?: string;
  /** kid con el que envolver la DEK; por defecto `STORAGE_ACTIVE_KID` o 'v1'. */
  kid?: string;
}

export function encryptObject(plaintext: Buffer, opts: EncryptOptions = {}): { ciphertext: Buffer; enc: EncMeta } {
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, dek, iv);
  if (opts.tenantId) cipher.setAAD(tenantAad(opts.tenantId));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const enc: EncMeta = {
    v: 1,
    alg: 'AES-256-GCM',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    dek: wrapKey(dek, opts.kid ?? activeKid()),
  };
  if (opts.tenantId) enc.aad = 'tenant';
  return { ciphertext, enc };
}

export function decryptObject(ciphertext: Buffer, enc: EncMeta, opts: { tenantId?: string } = {}): Buffer {
  if (enc?.alg !== 'AES-256-GCM') {
    throw new Error(`Algoritmo de cifrado no soportado: ${enc?.alg}`);
  }
  const dek = unwrapKey(enc.dek);
  const decipher = createDecipheriv(ALG, dek, Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  if (enc.aad === 'tenant') {
    if (!opts.tenantId) throw new Error('El objeto está ligado a un tenant: falta tenantId para descifrar');
    decipher.setAAD(tenantAad(opts.tenantId));
  }
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function isEncMeta(value: unknown): value is EncMeta {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return m.alg === 'AES-256-GCM' && typeof m.iv === 'string' && typeof m.tag === 'string' && !!m.dek;
}
