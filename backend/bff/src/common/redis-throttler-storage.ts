import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';
import { guardRedis } from '../redis/redis-guard';

/**
 * Almacén del rate-limit en Redis, compartido entre réplicas del BFF. Un único
 * script Lua hace INCR + PEXPIRE + bloqueo de forma atómica. Si Redis falla, el
 * request NO se rechaza: cae a un contador en memoria (fail-open degradado).
 */
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local pttl = redis.call('PTTL', KEYS[1])
local blockedTtl = redis.call('PTTL', KEYS[2])
if blockedTtl > 0 then return {hits, pttl, 1, blockedTtl} end
local block = tonumber(ARGV[3])
if hits > tonumber(ARGV[2]) and block > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', block)
  return {hits, pttl, 1, block}
end
return {hits, pttl, 0, 0}
`;

type Eval = (script: string, numKeys: number, ...args: (string | number)[]) => Promise<unknown>;

export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly log = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();
  private readonly redis: Redis | null;
  private readonly run: Eval;

  constructor(urlOrClient: string | { eval: Eval }) {
    if (typeof urlOrClient === 'string') {
      this.redis = new Redis(urlOrClient, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
      guardRedis(this.redis, 'throttler redis', this.log);
      this.run = (s, n, ...a) => this.redis!.eval(s, n, ...a);
    } else {
      this.redis = null;
      this.run = (s, n, ...a) => urlOrClient.eval(s, n, ...a);
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const k = `throttle:${throttlerName}:${key}`;
    try {
      const [hits, pttl, blocked, blockTtl] = (await this.run(SCRIPT, 2, k, `${k}:block`, ttl, limit, blockDuration)) as number[];
      return {
        totalHits: Number(hits),
        timeToExpire: Math.max(Math.ceil(Number(pttl) / 1000), 0),
        isBlocked: Number(blocked) === 1,
        timeToBlockExpire: Math.max(Math.ceil(Number(blockTtl) / 1000), 0),
      };
    } catch (error) {
      this.log.warn(`Redis no disponible para el throttler; uso memoria local: ${(error as Error).message}`);
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  onModuleDestroy() {
    this.fallback.onApplicationShutdown?.();
    this.redis?.disconnect();
  }
}
