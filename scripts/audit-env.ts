#!/usr/bin/env bun
/**
 * Revisa que los .env compartidos no lleven secretos reales ni que un
 * entorno que no es esta máquina local use los placeholders de ejemplo.
 *
 *   bun run audit:env
 *
 * No imprime valores. Sale 1 si hay algo que corregir.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dir, '..');
const EXAMPLE_PKI = 'prestige-pki-dev';
const PLACEHOLDER = /^REPLACE_ME/i;

type Kind = 'unique' | 'placeholder' | 'example-local-only' | 'empty';

interface Finding {
  file: string;
  key: string;
  kind: Kind;
  tracked: boolean;
}

const KEYS = ['STORAGE_MASTER_KEY', 'PKI_PASSPHRASE', 'WORKER_SHARED_SECRET', 'SESSION_SECRET'] as const;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.next' || name === 'backups') {
      continue;
    }
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(path, acc);
    else if (name === '.env' || name.startsWith('.env.')) acc.push(path);
  }
  return acc;
}

function tracked(path: string): boolean {
  const rel = relative(root, path).replaceAll('\\', '/');
  const proc = Bun.spawnSync(['git', 'ls-files', '--error-unmatch', rel], { cwd: root, stdout: 'ignore', stderr: 'ignore' });
  return proc.exitCode === 0;
}

function classify(key: string, value: string): Kind {
  const v = value.trim();
  if (!v) return 'empty';
  if (PLACEHOLDER.test(v)) return 'placeholder';
  if (key === 'PKI_PASSPHRASE' && v === EXAMPLE_PKI) return 'example-local-only';
  if (key === 'STORAGE_MASTER_KEY') {
    const buf = Buffer.from(v, 'base64');
    if (buf.length !== 32) return 'placeholder';
  }
  return 'unique';
}

function assignment(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) return undefined;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

const findings: Finding[] = [];
for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8');
  const isTracked = tracked(file);
  for (const key of KEYS) {
    const value = assignment(text, key);
    if (value === undefined) continue;
    findings.push({ file: relative(root, file), key, kind: classify(key, value), tracked: isTracked });
  }
}

const problems: string[] = [];
const notes: string[] = [];

for (const f of findings) {
  const where = `${f.file} :: ${f.key} = ${f.kind}${f.tracked ? ' (compartido)' : ' (local)'}`;
  if (f.tracked && f.kind === 'unique') {
    problems.push(`${where}: un .env compartido tiene un valor real. Déjalo en placeholder.`);
  } else if (f.tracked && f.kind === 'example-local-only') {
    notes.push(`${where}: el ejemplo local está documentado y gitleaks lo ignora. Producción lo rechaza.`);
  } else if (!f.tracked && f.kind === 'placeholder' && (f.key === 'STORAGE_MASTER_KEY' || f.key === 'WORKER_SHARED_SECRET' || f.key === 'SESSION_SECRET')) {
    problems.push(`${where}: ejecuta \`bun run gen-keys\` y pega un valor propio. El placeholder no sirve ni en local.`);
  } else if (!f.tracked && f.kind === 'example-local-only') {
    notes.push(`${where}: aceptable solo mientras Keycloak y Postgres apunten a localhost. No lo copies a otro entorno.`);
  } else if (!f.tracked && f.kind === 'empty' && (f.key === 'STORAGE_MASTER_KEY' || f.key === 'PKI_PASSPHRASE')) {
    problems.push(`${where}: valor vacío.`);
  } else {
    notes.push(where);
  }
}

const sharedUnique = new Map<string, string>();
const localUnique = new Map<string, string>();
for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8');
  const isTracked = tracked(file);
  for (const key of KEYS) {
    const value = assignment(text, key);
    if (!value || classify(key, value) !== 'unique') continue;
    const bucket = isTracked ? sharedUnique : localUnique;
    bucket.set(`${key}`, value);
    if (isTracked && localUnique.get(key) === value) {
      problems.push(`${relative(root, file)} comparte el ${key} real con un .env local. Rota el local y deja el ejemplo en placeholder.`);
    }
    if (!isTracked && sharedUnique.get(key) === value) {
      problems.push(`${relative(root, file)} repite el ${key} que está en un archivo compartido. Rota el valor local.`);
    }
  }
}

const pkiDir = join(root, 'backend', 'bff', 'pki');
const caCert = join(pkiDir, 'ca', 'intermediate.cert.pem');
const manifestKey = join(pkiDir, 'manifest-signing.key.pem');
if (!existsSync(caCert) || !existsSync(manifestKey)) {
  problems.push('Falta la CA o la llave del manifiesto. Ejecuta `bun run pki:init`.');
} else {
  notes.push('pki:init ya generó CA intermedia y llave Ed25519 del manifiesto (backend/bff/pki, gitignored).');
}

console.log('Auditoría de secretos (sin valores):');
for (const line of notes) console.log(`  · ${line}`);
if (problems.length) {
  console.error('Problemas:');
  for (const line of problems) console.error(`  · ${line}`);
  process.exit(1);
}
console.log('Sin problemas que bloqueen. Los valores de ejemplo no están en archivos compartidos como si fueran reales.');
