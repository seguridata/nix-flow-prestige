import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export type AdvisoryLockResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * DECISIÓN DE DISEÑO (varias réplicas, sin transacción abierta durante I/O):
 *
 * `withAdvisoryLock` (abajo) mantiene una transacción de Prisma abierta mientras
 * corre `fn`; si `fn` hace I/O externo (fetch a terceros, Temporal) ocupa una
 * conexión del pool hasta el timeout (5 min). Un lock de SESIÓN de Postgres no
 * sirve con el pool de Prisma (tomar y liberar deben ocurrir en la MISMA
 * conexión, que Prisma no garantiza fuera de una transacción). Por eso los
 * ticks usan `withTickLock`: un LEASE en Redis (`SET key token NX PX ttl`) que
 *  - no usa ninguna conexión de Postgres mientras `fn` corre,
 *  - se renueva con un latido mientras `fn` siga vivo y caduca solo (TTL) si la
 *    réplica muere, y
 *  - se libera con compare-and-delete (sólo el dueño del token lo borra).
 * Si Redis no está configurado o falla, `withTickLock` degrada al lock
 * transaccional de siempre (mismo comportamiento previo: correcto, pero con la
 * conexión retenida). La exclusión mutua es de mejor esfuerzo; la corrección
 * ante solapes la dan los claims idempotentes de cada trabajo (SKIP LOCKED del
 * outbox, claim con `updateMany` en las entregas de webhook).
 */
export interface LeaseRedis {
  set(key: string, value: string, px: 'PX', ttl: number, nx: 'NX'): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

const RELEASE_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const RENEW_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

/**
 * Ejecuta `fn` sólo si esta réplica obtiene el lease `key`. No espera: si otra
 * réplica lo tiene devuelve `{ acquired: false }`. Sin Redis (o si falla al
 * adquirir) usa `withAdvisoryLock` como respaldo.
 */
export async function withTickLock<T>(
  deps: { redis?: { client(): LeaseRedis | null } | null; prisma: Pick<PrismaClient, '$transaction'> },
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; timeoutMs?: number } = {},
): Promise<AdvisoryLockResult<T>> {
  const client = deps.redis?.client() ?? null;
  if (!client) return withAdvisoryLock(deps.prisma, key, fn, opts);

  const ttl = opts.ttlMs ?? 60_000;
  const token = randomUUID();
  const redisKey = `lock:${key}`;
  let got: string | null;
  try {
    got = await client.set(redisKey, token, 'PX', ttl, 'NX');
  } catch {
    return withAdvisoryLock(deps.prisma, key, fn, opts);
  }
  if (got !== 'OK') return { acquired: false };

  const beat = setInterval(() => {
    client.eval(RENEW_LUA, 1, redisKey, token, ttl).catch(() => undefined);
  }, Math.max(1_000, Math.floor(ttl / 3)));
  beat.unref?.();
  try {
    return { acquired: true, value: await fn() };
  } finally {
    clearInterval(beat);
    await client.eval(RELEASE_LUA, 1, redisKey, token).catch(() => undefined);
  }
}

/**
 * Ejecuta `fn` sólo si esta réplica obtiene el advisory lock `key` de Postgres.
 * Usa `pg_try_advisory_xact_lock` dentro de una transacción interactiva: el lock
 * se libera solo al terminar la transacción (commit, rollback o caída de la
 * conexión), sin riesgo de quedar huérfano en el pool. Si otra réplica ya lo
 * tiene, NO espera: devuelve `{ acquired: false }` y el tick se omite.
 *
 * ATENCIÓN: retiene una conexión del pool mientras `fn` corre; úsalo sólo como
 * respaldo o con `fn` corto (ver `withTickLock`).
 *
 * `fn` no recibe la transacción a propósito: sólo sirve para exclusión mutua
 * entre réplicas; el trabajo usa el cliente normal.
 */
export async function withAdvisoryLock<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  key: string,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<AdvisoryLockResult<T>> {
  const timeout = opts.timeoutMs ?? 5 * 60_000;
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
      if (!rows[0]?.locked) return { acquired: false } as const;
      return { acquired: true, value: await fn() } as const;
    },
    { timeout, maxWait: 5_000 },
  );
}
