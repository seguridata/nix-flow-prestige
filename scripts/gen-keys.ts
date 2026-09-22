#!/usr/bin/env bun
/**
 * Genera los secretos locales de Prestige y los deja listos para pegar en
 * `backend/bff/.env`. No sobrescribe nada: solo imprime.
 *
 *   bun run gen-keys
 */
import { randomBytes } from 'node:crypto';

const lines = [
  `# --- generados por scripts/gen-keys.ts el ${new Date().toISOString()} ---`,
  `STORAGE_MASTER_KEY=${randomBytes(32).toString('base64')}`,
  `WORKER_SHARED_SECRET=${randomBytes(32).toString('base64url')}`,
  `SESSION_SECRET=${randomBytes(32).toString('base64url')}`,
];

console.log(lines.join('\n'));
