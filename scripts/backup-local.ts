#!/usr/bin/env bun
/**
 * Copia local de la base `prestige` y del bucket MinIO `prestige-docs`.
 *
 *   bun run backup:local
 *
 * Escribe en `backups/local/<fecha>/` (o en `$BACKUP_DIR/<fecha>`). Puede
 * ser el mismo disco: no es un 3-2-1, es la diferencia entre cero copias y
 * una. Restaurar:
 *
 *   docker compose -f backend/docker-compose.yml exec -T postgres \
 *     pg_restore -U prestige -d prestige --clean --if-exists < prestige.dump
 *   mc mirror <dir>/minio local/prestige-docs
 *
 * Exige el compose ya levantado (postgres y minio). Sale distinto de cero
 * si el dump o el mirror fallan; no borra copias anteriores.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const repoRoot = join(import.meta.dir, '..');
const composeFile = join(repoRoot, 'backend', 'docker-compose.yml');
const composeDir = join(repoRoot, 'backend');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = resolve(process.env.BACKUP_DIR ?? join(repoRoot, 'backups', 'local'), stamp);

const pgUser = process.env.POSTGRES_USER ?? 'prestige';
const pgDb = process.env.POSTGRES_DB ?? 'prestige';
const minioUser = process.env.MINIO_ROOT_USER ?? 'prestige';
const minioPass = process.env.MINIO_ROOT_PASSWORD ?? 'prestige-minio';

function toWsl(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!drive) return normalized;
  return `/mnt/${drive[1].toLowerCase()}/${drive[2]}`;
}

/** En esta máquina el cliente de Windows apunta a un daemon apagado; el motor vive en WSL. */
function dockerLaunch(): { command: string; prefix: string[]; path: (p: string) => string } {
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0) {
    return { command: 'docker', prefix: [], path: (p) => p };
  }
  if (spawnSync('wsl', ['-e', 'docker', 'info'], { stdio: 'ignore' }).status === 0) {
    return { command: 'wsl', prefix: ['-e', 'docker'], path: toWsl };
  }
  throw new Error('No hay un daemon de Docker accesible, ni en Windows ni en WSL.');
}

const docker = dockerLaunch();

function runBash(script: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('wsl', ['-e', 'bash', '-lc', script], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`El volcado salió con código ${code}`));
    });
  });
}

function run(args: string[], stdoutPath?: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(docker.command, [...docker.prefix, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', stdoutPath ? 'pipe' : 'inherit', 'inherit'],
      env: process.env,
    });
    const writes: Promise<unknown>[] = [];
    if (stdoutPath && child.stdout) {
      const filePromise = open(stdoutPath, 'w').then(async (handle) => {
        for await (const chunk of child.stdout!) {
          await handle.write(chunk);
        }
        await handle.close();
      });
      writes.push(filePromise);
    }
    child.on('error', reject);
    child.on('close', (code) => {
      Promise.all(writes)
        .then(() => {
          if (code === 0) resolvePromise();
          else reject(new Error(`docker ${args.slice(0, 4).join(' ')} salió con código ${code}`));
        })
        .catch(reject);
    });
  });
}

mkdirSync(join(dest, 'minio'), { recursive: true });

const dumpPath = join(dest, 'prestige.dump');
console.log(`Backup en ${dest}`);

// El volcado es binario (-Fc). Si el daemon está en WSL, la redirección tiene
// que ocurrir dentro de Linux: un pipe hacia Windows corrompe el archivo.
const dumpArgs = [
  'compose',
  '-f',
  docker.path(composeFile),
  '--project-directory',
  docker.path(composeDir),
  'exec',
  '-T',
  'postgres',
  'pg_dump',
  '-U',
  pgUser,
  '-d',
  pgDb,
  '-Fc',
  '--no-owner',
];
if (docker.command === 'wsl') {
  const inner = ['docker', ...dumpArgs, '>', `'${docker.path(dumpPath).replaceAll("'", `'\\''`)}'`].join(' ');
  await runBash(inner);
} else {
  await run(dumpArgs, dumpPath);
}

const mirrorScript = [
  'set -eu',
  `mc alias set local http://minio:9000 ${shellQuote(minioUser)} ${shellQuote(minioPass)}`,
  'mc mirror --overwrite local/prestige-docs /backup/minio',
].join(' && ');

await run([
  'compose',
  '-f',
  docker.path(composeFile),
  '--project-directory',
  docker.path(composeDir),
  'run',
  '--rm',
  '--no-deps',
  '--entrypoint',
  '/bin/sh',
  '-v',
  `${docker.path(dest)}:/backup`,
  'minio-init',
  '-c',
  mirrorScript,
]);

writeFileSync(
  join(dest, 'README.txt'),
  [
    'Copia local de Prestige. Mismo disco si BACKUP_DIR no apunta a otro volumen.',
    'No sustituye un esquema 3-2-1 (otra máquina y otro sitio).',
    `Base: prestige.dump (pg_restore -d ${pgDb}).`,
    'Objetos: minio/ (mc mirror hacia el bucket prestige-docs).',
    `Generada: ${new Date().toISOString()}`,
    '',
  ].join('\n'),
);

console.log(`Listo: ${dumpPath} y ${join(dest, 'minio')}`);

function shellQuote(value: string): string {
  if (!/^[\w.@:+/-]+$/.test(value)) {
    throw new Error('Credencial de MinIO con caracteres no admitidos por el script de backup');
  }
  return value;
}
