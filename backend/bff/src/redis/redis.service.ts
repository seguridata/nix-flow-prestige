import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * M-transversal (D10) — cliente Redis real (`ioredis`). Sin `REDIS_URL` todo es
 * no-op y `withCache` degrada a llamar directamente al loader: el BFF funciona
 * igual, sin caché y con presencia WS por instancia.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);
  private main: Redis | null = null;
  private readonly extra: Redis[] = [];

  get enabled(): boolean {
    return Boolean(process.env.REDIS_URL);
  }

  /** Conexión principal (comandos). `null` si Redis no está configurado. */
  client(): Redis | null {
    if (!this.enabled) return null;
    if (!this.main) {
      this.main = new Redis(process.env.REDIS_URL as string, {
        maxRetriesPerRequest: 2,
        lazyConnect: false,
        enableOfflineQueue: true,
      });
      this.main.on('error', (e) => this.log.warn(`redis: ${e.message}`));
      this.main.once('connect', () => this.log.log(`Redis conectado (${maskRedisUrl(process.env.REDIS_URL)})`));
    }
    return this.main;
  }

  /** Conexión nueva (p. ej. para el adaptador pub/sub de Socket.IO). */
  duplicate(): Redis | null {
    const base = this.client();
    if (!base) return null;
    const dup = base.duplicate();
    dup.on('error', (e) => this.log.warn(`redis(dup): ${e.message}`));
    this.extra.push(dup);
    return dup;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const c = this.client();
    if (!c) return null;
    try {
      const raw = await c.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (e) {
      this.log.warn(`getJson ${key}: ${(e as Error).message}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const c = this.client();
    if (!c) return;
    try {
      await c.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.floor(ttlSeconds)));
    } catch (e) {
      this.log.warn(`setJson ${key}: ${(e as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    const c = this.client();
    if (!c || keys.length === 0) return;
    try {
      await c.del(...keys);
    } catch (e) {
      this.log.warn(`del: ${(e as Error).message}`);
    }
  }

  /**
   * Caché de lectura: devuelve el valor cacheado o ejecuta `loader`, cachea su
   * resultado `ttlSeconds` y lo devuelve. Cualquier fallo de Redis cae al loader.
   */
  async withCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const hit = await this.getJson<T>(key);
    if (hit !== null) return hit;
    const value = await loader();
    if (value !== undefined && value !== null) await this.setJson(key, value, ttlSeconds);
    return value;
  }

  async onModuleDestroy() {
    for (const c of [this.main, ...this.extra]) {
      try {
        c?.disconnect();
      } catch {
        /* noop */
      }
    }
  }
}

/** Oculta usuario/contraseña de una URL redis:// para poder loguearla. */
export function maskRedisUrl(url?: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = '***';
      u.password = '';
    }
    return u.toString();
  } catch {
    return '<redis-url>';
  }
}
