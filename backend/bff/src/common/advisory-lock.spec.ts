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
