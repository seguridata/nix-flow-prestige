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
import { existsSync } from 'node:fs';
import { ensureCaChain } from '../backend/bff/src/signing/pki/ca';

const caDir = join(import.meta.dir, '..', 'backend', 'bff', 'pki', 'ca');
const already = existsSync(join(caDir, 'intermediate.cert.pem'));
ensureCaChain(caDir);
console.log(already ? `CA ya existía en ${caDir}` : `CA generada en ${caDir}`);
