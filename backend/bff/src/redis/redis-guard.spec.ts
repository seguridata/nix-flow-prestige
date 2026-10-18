import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import { describe, expect, it } from 'vitest';
import { guardRedis } from './redis-guard';
import { RedisThrottlerStorage } from '../common/redis-throttler-storage';

const silent = { warn: () => undefined } as never;

function collectUnhandled() {
  const seen: unknown[] = [];
  const h = (e: unknown) => seen.push(e);
  process.on('unhandledRejection', h);
  return { seen, stop: () => process.off('unhandledRejection', h) };
}

describe('guardRedis', () => {
  it('cliente falso que emite error y rechaza comandos: no lanza ni genera unhandledRejection', async () => {
    const fake = Object.assign(new EventEmitter(), {
      sendCommand: () => Promise.reject(new Error('Reached the max retries per request limit')),
    });
    const spy = collectUnhandled();
    guardRedis(fake as never, 'fake', silent);
    expect(() => fake.emit('error', new Error('ECONNREFUSED'))).not.toThrow();
    fake.sendCommand(); // fire and forget, como el adaptador de Socket.IO
    await new Promise((r) => setTimeout(r, 50));
    spy.stop();
    expect(spy.seen).toEqual([]);
    // quien hace await sigue viendo el rechazo (para poder degradar)
    await expect(fake.sendCommand()).rejects.toThrow('max retries');
  });

  it('ioredis real contra un Redis inexistente: el proceso no muere', async () => {
    const spy = collectUnhandled();
    const c = new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: 1, retryStrategy: () => 100 });
    guardRedis(c, 'real', silent);
    void c.publish('x', 'y'); // sin await ni catch
    void c.subscribe('canal');
    await new Promise((r) => setTimeout(r, 800));
    c.disconnect();
    spy.stop();
    expect(spy.seen).toEqual([]);
  });

  it('RedisThrottlerStorage con URL caída degrada a memoria sin lanzar', async () => {
    const spy = collectUnhandled();
    const storage = new RedisThrottlerStorage('redis://127.0.0.1:1');
    const r = await storage.increment('k', 1000, 5, 0, 'default');
    expect(r.totalHits).toBe(1);
    await new Promise((res) => setTimeout(res, 300));
    storage.onModuleDestroy();
    spy.stop();
    expect(spy.seen).toEqual([]);
  });
});
