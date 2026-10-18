import { describe, expect, it, vi } from 'vitest';
import { withAdvisoryLock } from './advisory-lock';

/** Prisma falso: un lock compartido por clave, como Postgres entre réplicas. */
function fakeDb() {
  const held = new Set<string>();
  return {
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      let key = '';
      const tx = {
        $queryRaw: async (_s: TemplateStringsArray, k: string) => {
          key = k;
          if (held.has(k)) return [{ locked: false }];
          held.add(k);
          return [{ locked: true }];
        },
      };
      try {
        return await cb(tx);
      } finally {
        held.delete(key); // el xact lock se libera al terminar la transacción
      }
    },
  };
}

describe('withAdvisoryLock', () => {
  it('ejecuta fn y devuelve su valor cuando obtiene el lock', async () => {
    const db = fakeDb();
    const fn = vi.fn().mockResolvedValue(42);
    const r = await withAdvisoryLock(db as never, 'k', fn);
    expect(r).toEqual({ acquired: true, value: 42 });
  });

  it('si otra réplica tiene el lock, omite el tick sin ejecutar fn', async () => {
    const db = fakeDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = withAdvisoryLock(db as never, 'k', () => gate);
    await new Promise((r) => setTimeout(r, 1));
    const fn2 = vi.fn();
    const second = await withAdvisoryLock(db as never, 'k', fn2);
    expect(second).toEqual({ acquired: false });
    expect(fn2).not.toHaveBeenCalled();
    release();
    await first;
    // liberado: ahora sí se puede
    expect((await withAdvisoryLock(db as never, 'k', async () => 1)).acquired).toBe(true);
  });

  it('claves distintas no se bloquean entre sí', async () => {
    const db = fakeDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = withAdvisoryLock(db as never, 'a', () => gate);
    await new Promise((r) => setTimeout(r, 1));
    expect((await withAdvisoryLock(db as never, 'b', async () => 1)).acquired).toBe(true);
    release();
    await a;
  });

  it('libera el lock aunque fn lance', async () => {
    const db = fakeDb();
    await expect(withAdvisoryLock(db as never, 'k', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect((await withAdvisoryLock(db as never, 'k', async () => 1)).acquired).toBe(true);
  });
});

import { withTickLock } from './advisory-lock';

/** Redis falso con SET NX PX y EVAL compare-and-delete/pexpire. */
function fakeRedis() {
  const kv = new Map<string, string>();
  const client = {
    set: vi.fn(async (k: string, v: string, _px: 'PX', _ttl: number, _nx: 'NX') => {
      if (kv.has(k)) return null;
      kv.set(k, v);
      return 'OK';
    }),
    eval: vi.fn(async (script: string, _n: number, k: string, token: string) => {
      if (kv.get(k) !== token) return 0;
      if (script.includes("'del'")) kv.delete(k);
      return 1;
    }),
  };
  return { redis: { client: () => client }, client, kv };
}

describe('withTickLock', () => {
  it('toma el lease en Redis y NO abre transacción de Postgres durante fn', async () => {
    const { redis, kv } = fakeRedis();
    const $transaction = vi.fn();
    const r = await withTickLock({ redis, prisma: { $transaction } as never }, 'k', async () => {
      expect(kv.size).toBe(1); // lease tomado mientras corre fn
      return 7;
    });
    expect(r).toEqual({ acquired: true, value: 7 });
    expect($transaction).not.toHaveBeenCalled();
    expect(kv.size).toBe(0); // liberado
  });

  it('otra réplica con el lease => no ejecuta fn', async () => {
    const { redis } = fakeRedis();
    const deps = { redis, prisma: { $transaction: vi.fn() } as never };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = withTickLock(deps, 'k', () => gate);
    await new Promise((r) => setTimeout(r, 1));
    const fn2 = vi.fn();
    expect(await withTickLock(deps, 'k', fn2)).toEqual({ acquired: false });
    expect(fn2).not.toHaveBeenCalled();
    release();
    await first;
    expect((await withTickLock(deps, 'k', async () => 1)).acquired).toBe(true);
  });

  it('libera el lease aunque fn lance', async () => {
    const { redis, kv } = fakeRedis();
    const deps = { redis, prisma: { $transaction: vi.fn() } as never };
    await expect(withTickLock(deps, 'k', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(kv.size).toBe(0);
  });

  it('sin Redis usa el lock transaccional de respaldo', async () => {
    const db = fakeDb();
    const r = await withTickLock({ redis: { client: () => null }, prisma: db as never }, 'k', async () => 3);
    expect(r).toEqual({ acquired: true, value: 3 });
  });

  it('si Redis falla al adquirir, cae al respaldo transaccional', async () => {
    const db = fakeDb();
    const redis = { client: () => ({ set: async () => { throw new Error('down'); }, eval: vi.fn() }) };
    const r = await withTickLock({ redis, prisma: db as never }, 'k', async () => 9);
    expect(r).toEqual({ acquired: true, value: 9 });
  });

  it('renueva el lease con latido mientras fn sigue vivo', async () => {
    vi.useFakeTimers();
    try {
      const { redis, client } = fakeRedis();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const p = withTickLock({ redis, prisma: {} as never }, 'k', () => gate, { ttlMs: 3_000 });
      await vi.advanceTimersByTimeAsync(2_100);
      const renews = client.eval.mock.calls.filter((c) => String(c[0]).includes('pexpire'));
      expect(renews.length).toBeGreaterThanOrEqual(2);
      release();
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
});
