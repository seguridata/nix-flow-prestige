/**
 * Frontera entre el ejemplo del repositorio y un secreto de entorno.
 *
 * `REPLACE_ME…` no es válido en ningún sitio, ni en la máquina de desarrollo:
 * `bun run gen-keys` tiene que haber corrido.
 *
 * `PKI_PASSPHRASE=prestige-pki-dev` solo se acepta cuando el proceso habla
 * con Keycloak y Postgres en localhost y no está en `NODE_ENV=production`.
 * Los PKCS#12 locales se cifraron con esa frase; rotarla sin reemitir los
 * certificados los deja ilegibles. Cualquier otro entorno debe traer la suya.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const EXAMPLE_PKI = 'prestige-pki-dev';
/** Credenciales S3/MinIO de desarrollo conocidas (no válidas en producción). */
const KNOWN_S3_DEFAULTS = new Set(['prestige', 'prestige-minio', 'minioadmin']);

export interface SecretInspection {
  fatal: string[];
  warnings: string[];
}

function localStack(env: NodeJS.ProcessEnv): boolean {
  const issuer = env.KEYCLOAK_ISSUER ?? '';
  const database = env.DATABASE_URL ?? '';
  return /localhost|127\.0\.0\.1/.test(issuer) && /localhost|127\.0\.0\.1/.test(database);
}

function masterKeyError(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (!value || /^REPLACE_ME/i.test(value)) {
    return 'STORAGE_MASTER_KEY ausente o de ejemplo. Ejecuta `bun run gen-keys` y usa el valor en este entorno.';
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    return 'STORAGE_MASTER_KEY debe ser base64 de exactamente 32 bytes.';
  }
  return null;
}

/** Misma ruta que `ManifestSigner`: la llave Ed25519 vive en PKI_DIR, no en una env. */
function manifestKeyPresent(env: NodeJS.ProcessEnv, fileExists: (p: string) => boolean): boolean {
  const dir = env.PKI_DIR ? join(process.cwd(), env.PKI_DIR.replace(/^\.\//, '')) : join(process.cwd(), 'pki');
  return (
    fileExists(join(dir, 'manifest-signing.key.pem')) && fileExists(join(dir, 'manifest-signing.pub.pem'))
  );
}

function dbPasswordIsDefault(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return decodeURIComponent(new URL(url).password) === 'prestige';
  } catch {
    return /:prestige@/.test(url);
  }
}

export function inspectRuntimeSecrets(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (p: string) => boolean = existsSync,
): SecretInspection {
  const fatal: string[] = [];
  const warnings: string[] = [];
  const master = masterKeyError(env.STORAGE_MASTER_KEY);
  if (master) fatal.push(master);

  const worker = env.WORKER_SHARED_SECRET?.trim() ?? '';
  if (!worker || /^REPLACE_ME/i.test(worker)) {
    fatal.push('WORKER_SHARED_SECRET ausente o de ejemplo. Ejecuta `bun run gen-keys`.');
  }

  const pki = env.PKI_PASSPHRASE?.trim() ?? '';
  const production = env.NODE_ENV === 'production';
  const local = !production && localStack(env);
  if (!pki || /^REPLACE_ME/i.test(pki)) {
    fatal.push('PKI_PASSPHRASE ausente o de ejemplo. Define una frase propia de este entorno.');
  } else if (pki === EXAMPLE_PKI && !local) {
    fatal.push(
      'PKI_PASSPHRASE=prestige-pki-dev solo es válido en una máquina local (Keycloak y Postgres en localhost, NODE_ENV distinto de production).',
    );
  } else if (pki === EXAMPLE_PKI) {
    warnings.push(
      'PKI_PASSPHRASE es el valor de ejemplo. Sirve en esta máquina porque los PKCS#12 locales se cifraron con él. No lo copies a otro entorno.',
    );
  }

  // ---- Endurecimiento de producción: fatal en production, aviso en el resto ----
  const sink = production ? fatal : warnings;
  const prod = (msg: string) => sink.push(production ? msg : `[producción] ${msg}`);

  const s3Access = env.S3_ACCESS_KEY?.trim() ?? '';
  const s3Secret = env.S3_SECRET_KEY?.trim() ?? '';
  if (!s3Access || !s3Secret) {
    prod('S3_ACCESS_KEY / S3_SECRET_KEY son obligatorias (sin ellas el cliente S3 usa credenciales de MinIO de desarrollo).');
  } else if (KNOWN_S3_DEFAULTS.has(s3Access) || KNOWN_S3_DEFAULTS.has(s3Secret)) {
    prod('S3_ACCESS_KEY / S3_SECRET_KEY son las credenciales por defecto de MinIO (prestige / prestige-minio).');
  }
  if (dbPasswordIsDefault(env.DATABASE_URL)) {
    prod("DATABASE_URL usa la contraseña por defecto 'prestige'.");
  }
  if (!env.KEYCLOAK_ISSUER?.trim()) {
    prod('KEYCLOAK_ISSUER no está definido: todas las rutas autenticadas responderían 401.');
  }
  if (!manifestKeyPresent(env, fileExists)) {
    prod('Falta la llave Ed25519 de firma del manifiesto (PKI_DIR/manifest-signing.key.pem y .pub.pem; `bun run pki:init`).');
  }
  if (!env.SMTP_HOST?.trim()) {
    prod('SMTP_HOST no está definido: la bandeja de correo no se despacharía.');
  }
  if (!env.TSA_URL?.trim()) {
    prod('TSA_URL no está definido: el manifiesto se sellaría sin RFC 3161.');
  }
  return { fatal, warnings };
}

export function assertRuntimeSecrets(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (p: string) => boolean = existsSync,
): SecretInspection {
  const inspection = inspectRuntimeSecrets(env, fileExists);
  if (inspection.fatal.length) {
    throw new Error(inspection.fatal.join(' '));
  }
  return inspection;
}
