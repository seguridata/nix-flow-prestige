import type { PrismaClient } from '@prisma/client';

export type AdvisoryLockResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Ejecuta `fn` sólo si esta réplica obtiene el advisory lock `key` de Postgres.
 * Usa `pg_try_advisory_xact_lock` dentro de una transacción interactiva: el lock
 * se libera solo al terminar la transacción (commit, rollback o caída de la
 * conexión), sin riesgo de quedar huérfano en el pool. Si otra réplica ya lo
 * tiene, NO espera: devuelve `{ acquired: false }` y el tick se omite.
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
