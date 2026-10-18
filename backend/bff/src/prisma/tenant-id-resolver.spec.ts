import { describe, expect, it, vi } from 'vitest';
import type { RedisService } from '../redis/redis.service';
import type { PrismaService } from './prisma.service';
import { TENANT_ID_CACHE_TTL_SECONDS, TenantIdResolver } from './tenant-id-resolver';

const UUID = '11111111-2222-3333-4444-555555555555';

function make(rows: { id: string; slug: string }[]) {
  const findFirst = vi.fn(async ({ where }: { where: { OR: { id?: string; slug?: string }[] } }) => {
    const hit = rows.find((r) => where.OR.some((c) => c.id === r.id || c.slug === r.slug));
    return hit ? { id: hit.id } : null;
  });
  const prisma = { tenant: { findFirst } } as unknown as PrismaService;
  return { prisma, findFirst };
}

/** Redis de mentira con la misma semántica de `withCache` (no cachea null/undefined). */
function fakeRedis() {
  const store = new Map<string, unknown>();
  const ttls: number[] = [];
  const redis = {
    withCache: vi.fn(async (key: string, ttl: number, loader: () => Promise<unknown>) => {
      if (store.has(key)) return store.get(key);
      const v = await loader();
      if (v !== null && v !== undefined) {
        store.set(key, v);
        ttls.push(ttl);
      }
      return v;
    }),
  } as unknown as RedisService;
  return { redis, store, ttls };
}

describe('TenantIdResolver', () => {
  it('slug -> uuid, con una consulta por las claves únicas de Tenant', async () => {
    const { prisma, findFirst } = make([{ id: UUID, slug: 'acme' }]);
    const r = new TenantIdResolver(prisma);
    expect(await r.toId('acme')).toBe(UUID);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: 'acme' }, { slug: 'acme' }] },
      select: { id: true },
    });
  });

  it('uuid -> el mismo uuid (si existe)', async () => {
    const { prisma } = make([{ id: UUID, slug: 'acme' }]);
    expect(await new TenantIdResolver(prisma).toId(UUID)).toBe(UUID);
  });

  it('inexistente o vacío -> null (los llamadores devuelven vacío/404), sin consultar si está vacío', async () => {
    const { prisma, findFirst } = make([{ id: UUID, slug: 'acme' }]);
    const r = new TenantIdResolver(prisma);
    expect(await r.toId('fantasma')).toBeNull();
    expect(await r.toId('')).toBeNull();
    expect(await r.toId('   ')).toBeNull();
    expect(await r.toId(undefined)).toBeNull();
    expect(await r.toId(null)).toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('sin Redis consulta directo cada vez (sin estado en el proceso)', async () => {
    const { prisma, findFirst } = make([{ id: UUID, slug: 'acme' }]);
    const r = new TenantIdResolver(prisma);
    await r.toId('acme');
    await r.toId('acme');
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('con Redis: cachea por valor consultado ~5 min y no repite la consulta', async () => {
    const { prisma, findFirst } = make([{ id: UUID, slug: 'acme' }]);
    const { redis, store, ttls } = fakeRedis();
    const r = new TenantIdResolver(prisma, redis);
    expect(await r.toId('acme')).toBe(UUID);
    expect(await r.toId('acme')).toBe(UUID);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect([...store.keys()]).toEqual(['tenant:id:acme']);
    expect(ttls).toEqual([TENANT_ID_CACHE_TTL_SECONDS]);
    expect(TENANT_ID_CACHE_TTL_SECONDS).toBe(300);
    // la misma entidad consultada por su uuid usa otra clave (la clave lleva el valor consultado)
    await r.toId(UUID);
    expect(store.has(`tenant:id:${UUID}`)).toBe(true);
  });

  it('con Redis no cachea lo inexistente (un alta posterior se ve de inmediato)', async () => {
    const rows: { id: string; slug: string }[] = [];
    const { prisma, findFirst } = make(rows);
    const { redis, store } = fakeRedis();
    const r = new TenantIdResolver(prisma, redis);
    expect(await r.toId('nuevo')).toBeNull();
    expect(store.size).toBe(0);
    rows.push({ id: UUID, slug: 'nuevo' });
    expect(await r.toId('nuevo')).toBe(UUID);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('el valor se recorta antes de consultar/cachear', async () => {
    const { prisma, findFirst } = make([{ id: UUID, slug: 'acme' }]);
    expect(await new TenantIdResolver(prisma).toId('  acme ')).toBe(UUID);
    expect(findFirst.mock.calls[0][0].where.OR[1]).toEqual({ slug: 'acme' });
  });
});
