import { describe, expect, it } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler-storage';

describe('RedisThrottlerStorage', () => {
  it('traduce la respuesta del script a ThrottlerStorageRecord', async () => {
    const s = new RedisThrottlerStorage({ eval: async () => [3, 45_000, 1, 10_000] });
    expect(await s.increment('ip', 60_000, 2, 10_000, 'default')).toEqual({
      totalHits: 3,
      timeToExpire: 45,
      isBlocked: true,
      timeToBlockExpire: 10,
    });
  });

  it('si Redis falla cae a memoria local y sigue contando', async () => {
    const s = new RedisThrottlerStorage({ eval: async () => { throw new Error('down'); } });
    const a = await s.increment('ip', 60_000, 5, 0, 'default');
    const b = await s.increment('ip', 60_000, 5, 0, 'default');
    expect([a.totalHits, b.totalHits]).toEqual([1, 2]);
    s.onModuleDestroy();
  });
});
