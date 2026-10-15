import { describe, expect, it } from 'vitest';
import { ConcurrencyLimiter, ServiceBusyException } from './concurrency-limiter';

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));

describe('ConcurrencyLimiter', () => {
  it('no excede la concurrencia y encola el resto en orden FIFO', async () => {
    const lim = new ConcurrencyLimiter('t', 1, 5);
    const order: number[] = [];
    const gates = [defer(), defer(), defer()];
    const runs = gates.map((g, i) =>
      lim.run(async () => {
        order.push(i);
        await g.promise;
      }),
    );
    await tick();
    expect(lim.running).toBe(1);
    expect(lim.queued).toBe(2);
    expect(order).toEqual([0]);
    gates[0].resolve();
    await tick();
    expect(order).toEqual([0, 1]);
    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(runs);
    expect(order).toEqual([0, 1, 2]);
    expect(lim.running).toBe(0);
    expect(lim.queued).toBe(0);
  });

  it('con cola llena rechaza con 503 y retryAfterSeconds', async () => {
    const lim = new ConcurrencyLimiter('OCR', 1, 1, 7);
    const g = defer();
    const a = lim.run(() => g.promise);
    const b = lim.run(async () => 'b');
    await tick();
    const err = await lim.run(async () => 'c').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceBusyException);
    expect(err.getStatus()).toBe(503);
    expect(err.retryAfterSeconds).toBe(7);
    g.resolve();
    await Promise.all([a, b]);
  });

  it('libera el permiso aunque la tarea falle', async () => {
    const lim = new ConcurrencyLimiter('t', 1, 1);
    await expect(lim.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(lim.run(async () => 'ok')).resolves.toBe('ok');
    expect(lim.running).toBe(0);
  });

  it('permite N tareas simultáneas', async () => {
    const lim = new ConcurrencyLimiter('t', 2, 0);
    const g = defer();
    const a = lim.run(() => g.promise);
    const b = lim.run(() => g.promise);
    await tick();
    expect(lim.running).toBe(2);
    await expect(lim.run(async () => 1)).rejects.toBeInstanceOf(ServiceBusyException);
    g.resolve();
    await Promise.all([a, b]);
  });
});
