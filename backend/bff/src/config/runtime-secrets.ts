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

const EXAMPLE_PKI = 'prestige-pki-dev';

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

export function inspectRuntimeSecrets(env: NodeJS.ProcessEnv = process.env): SecretInspection {
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
  return { fatal, warnings };
}

export function assertRuntimeSecrets(env: NodeJS.ProcessEnv = process.env): SecretInspection {
  const inspection = inspectRuntimeSecrets(env);
  if (inspection.fatal.length) {
    throw new Error(inspection.fatal.join(' '));
  }
  return inspection;
}
