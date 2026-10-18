/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway';

function setup() {
  const prisma = {
    document: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.id === 'docA' && where.tenantId === 'A' ? { id: 'docA' } : null,
      ),
    },
  };
  const gw = new RealtimeGateway({ duplicate: () => null, client: () => null, enabled: false } as any, prisma as any);
  (gw as any).server = { to: () => ({ emit: vi.fn() }) };
  const mkClient = (id: string, tenantId: string) => {
    (gw as any).socketUsers.set(id, { actorId: id, tenantId });
    (gw as any).socketMemberships.set(id, new Map());
    return { id, join: vi.fn(), leave: vi.fn(), disconnect: vi.fn() } as any;
  };
  return { gw, mkClient };
}

describe('RealtimeGateway - tenant', () => {
  it('join-document de documento ajeno: no se une a la sala', async () => {
    const { gw, mkClient } = setup();
    const b = mkClient('b', 'B');
    const res = await gw.handleJoinDocument(b, { documentId: 'docA' });
    expect(b.join).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: 'not-found' });
  });

  it('join-document del propio tenant: se une', async () => {
    const { gw, mkClient } = setup();
    const a = mkClient('a', 'A');
    await gw.handleJoinDocument(a, { documentId: 'docA' });
    expect(a.join).toHaveBeenCalledWith('document:docA');
  });

  it('handshake invalido/sin tenant: desconecta y no registra usuario', async () => {
    const { gw } = setup();
    const client = { id: 'x', handshake: { auth: { token: 't' }, headers: {} }, disconnect: vi.fn() } as any;
    await gw.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect((gw as any).socketUsers.has('x')).toBe(false);
  });
});

function fakeRedis() {
  const hashes = new Map<string, Map<string, string>>();
  const ttl = new Map<string, number>();
  const h = (k: string) => hashes.get(k) ?? hashes.set(k, new Map()).get(k)!;
  const client: any = {
    hexists: async (k: string, f: string) => (h(k).has(f) ? 1 : 0),
    hset: async (k: string, f: string, v: string) => void h(k).set(f, v),
    expire: async (k: string, s: number) => void ttl.set(k, s),
    hdel: async (k: string, f: string) => void h(k).delete(f),
    hgetall: async (k: string) => Object.fromEntries(h(k)),
    pipeline: () => {
      const ops: Array<() => Promise<unknown>> = [];
      const p: any = {
        hset: (k: string, f: string, v: string) => (ops.push(() => client.hset(k, f, v)), p),
        expire: (k: string, s: number) => (ops.push(() => client.expire(k, s)), p),
        exec: async () => {
          for (const o of ops) await o();
          return [];
        },
      };
      return p;
    },
  };
  return { client, hashes, ttl, redis: { duplicate: () => null, client: () => client, enabled: true } };
}

describe('RealtimeGateway - presencia en Redis', () => {
  const build = (redis: any) => {
    const prisma = { document: { findFirst: vi.fn(async () => ({ id: 'docA' })) } };
    const gw = new RealtimeGateway(redis, prisma as any);
    const emit = vi.fn();
    (gw as any).server = { to: () => ({ emit }) };
    const mk = (id: string, tenantId = 'A') => {
      (gw as any).socketUsers.set(id, { actorId: id, name: `N-${id}`, tenantId });
      (gw as any).socketMemberships.set(id, new Map());
      return { id, join: vi.fn(), leave: vi.fn() } as any;
    };
    return { gw, emit, mk };
  };

  it('join guarda en presence:{tenant}:{doc} con TTL y emite presence-update', async () => {
    const f = fakeRedis();
    const { gw, emit, mk } = build(f.redis);
    await gw.handleJoinDocument(mk('a'), { documentId: 'docA' });
    expect(f.hashes.get('presence:A:docA')?.has('a')).toBe(true);
    expect(f.ttl.get('presence:A:docA')).toBe(60);
    const upd = emit.mock.calls.find((c) => c[0] === 'presence-update')![1];
    expect(upd).toMatchObject({ documentId: 'docA', actors: [{ actorId: 'a', actorName: 'N-a' }] });
    (gw as any).onModuleDestroy();
  });

  it('otra réplica ve la presencia y disconnect la elimina', async () => {
    const f = fakeRedis();
    const r1 = build(f.redis);
    const r2 = build(f.redis);
    const c1 = r1.mk('a');
    await r1.gw.handleJoinDocument(c1, { documentId: 'docA' });
    await r2.gw.handleJoinDocument(r2.mk('b'), { documentId: 'docA' });
    const last = r2.emit.mock.calls.filter((c) => c[0] === 'presence-update').pop()![1];
    expect(last.actors.map((x: any) => x.actorId).sort()).toEqual(['a', 'b']);
    await r1.gw.handleDisconnect(c1);
    expect(f.hashes.get('presence:A:docA')?.has('a')).toBe(false);
    (r1.gw as any).onModuleDestroy();
    (r2.gw as any).onModuleDestroy();
  });

  it('la presencia está acotada por tenant (clave distinta)', async () => {
    const f = fakeRedis();
    const { gw, mk } = build(f.redis);
    await gw.handleJoinDocument(mk('a', 'A'), { documentId: 'docA' });
    expect(f.hashes.has('presence:B:docA')).toBe(false);
    (gw as any).onModuleDestroy();
  });

  it('si Redis falla cae al Map en memoria sin romper el contrato', async () => {
    const broken: any = new Proxy({}, { get: () => async () => Promise.reject(new Error('down')) });
    const { gw, emit, mk } = build({ duplicate: () => null, enabled: true, client: () => broken });
    const res = await gw.handleJoinDocument(mk('a'), { documentId: 'docA' });
    expect(res).toEqual({ ok: true });
    const upd = emit.mock.calls.find((c) => c[0] === 'presence-update')![1];
    expect(upd.actors).toHaveLength(1);
    (gw as any).onModuleDestroy();
  });

  it('descarta campos sin latido reciente (réplica caída)', async () => {
    const f = fakeRedis();
    f.hashes.set(
      'presence:A:docA',
      new Map([['ghost', JSON.stringify({ actorName: 'G', since: '2020-01-01T00:00:00Z', at: '2020-01-01T00:00:00Z' })]]),
    );
    const { gw, emit, mk } = build(f.redis);
    await gw.handleJoinDocument(mk('a'), { documentId: 'docA' });
    const upd = emit.mock.calls.find((c) => c[0] === 'presence-update')![1];
    expect(upd.actors.map((x: any) => x.actorId)).toEqual(['a']);
    (gw as any).onModuleDestroy();
  });
});
