#!/usr/bin/env bun
/**
 * Genera la CA interna del proyecto (raíz + intermedia) que emite los
 * certificados de firma DIGITAL. Idempotente: si ya existen, no hace nada.
 *
 *   bun run pki:init
 *
 * Salida en `backend/bff/pki/ca/` (gitignored). En producción esta CA se
 * sustituye por el PKI de SeguriData vía el custodio PKCS#11.
 */
import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { ensureCaChain } from '../backend/bff/src/signing/pki/ca';

const pkiDir = join(import.meta.dir, '..', 'backend', 'bff', 'pki');
const caDir = join(pkiDir, 'ca');
const already = existsSync(join(caDir, 'intermediate.cert.pem'));
ensureCaChain(caDir);
console.log(already ? `CA ya existía en ${caDir}` : `CA generada en ${caDir}`);

// Llave de firma del manifiesto de evidencia (Ed25519). El manifiesto se
// firma append-only y se verifica offline con la pública.
const mKey = join(pkiDir, 'manifest-signing.key.pem');
const mPub = join(pkiDir, 'manifest-signing.pub.pem');
if (!existsSync(mKey)) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(mKey, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600 });
  writeFileSync(mPub, publicKey.export({ type: 'spki', format: 'pem' }) as string);
  console.log('Llave de firma del manifiesto (Ed25519) generada.');
} else {
  console.log('Llave de firma del manifiesto ya existía.');
}
