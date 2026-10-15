import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  IdempotencyInterceptor,
  cacheableBody,
  isSafeIdempotencyKey,
  requestFingerprint,
} from './idempotency.interceptor';

class FakeRedis {
  store = new Map<string, string>();
  ttl = new Map<string, number>();
  async set(k: string, v: string, _ex: string, ttl: number, nx?: string) {
    if (nx === 'NX' && this.store.has(k)) return null;
    this.store.set(k, v);
    this.ttl.set(k, ttl);
    return 'OK';
  }
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async del(k: string) {
    this.store.delete(k);
    return 1;
  }
}

function ctx(over: { method?: string; headers?: Record<string, string>; user?: unknown; body?: unknown; url?: string } = {}) {
  const res = { setHeader: vi.fn(), status: vi.fn(), headersSent: false, getHeader: vi.fn() };
  const req = {
    method: over.method ?? 'POST',
    headers: over.headers ?? { 'idempotency-key': 'k-1' },
    user: 'user' in over ? over.user : { tenantId: 'acme', actorId: 'u1' },
    body: over.body ?? { a: 1 },
    originalUrl: over.url ?? '/documents/x/freeze',
  };
  return {
    res,
    context: {
      getType: () => 'http',
      getHandler: () => function handler() {},
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as never,
  };
}

const make = (redis: FakeRedis | null) =>
  new IdempotencyInterceptor(redis ? ({ client: () => redis } as never) : ({ client: () => null } as never));

describe('IdempotencyInterceptor', () => {
  it('sin header, sin Redis, GET, sin usuario o multipart: no hace nada', async () => {
    const redis = new FakeRedis();
    const handler = vi.fn(() => of({ ok: 1 }));
    await make(redis).intercept(ctx({ headers: {} }).context, { handle: handler });
    await make(null).intercept(ctx().context, { handle: handler });
    await make(redis).intercept(ctx({ method: 'GET' }).context, { handle: handler });
    await make(redis).intercept(ctx({ user: undefined }).context, { handle: handler });
    await make(redis).intercept(
      ctx({ headers: { 'idempotency-key': 'k', 'content-type': 'multipart/form-data; boundary=x' } }).context,
      { handle: handler },
    );
    expect(handler).toHaveBeenCalledTimes(5);
    expect(redis.store.size).toBe(0);
  });

  it('primera ejecución guarda 2xx JSON con clave idem:tenant:actor:key y TTL 24 h; la segunda lo reutiliza', async () => {
    const redis = new FakeRedis();
    const svc = make(redis);
    const handler = vi.fn(() => of({ id: 'doc-1' }));
    const first = await svc.intercept(ctx().context, { handle: handler });
    expect(await lastValueFrom(first)).toEqual({ id: 'doc-1' });
    expect([...redis.store.keys()]).toEqual(['idem:acme:u1:k-1']);
    expect(redis.ttl.get('idem:acme:u1:k-1')).toBe(86_400);

    const c2 = ctx();
    const second = await svc.intercept(c2.context, { handle: handler });
    expect(await lastValueFrom(second)).toEqual({ id: 'doc-1' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(c2.res.setHeader).toHaveBeenCalledWith('Idempotent-Replay', 'true');
  });

  it('misma clave con otro cuerpo o ruta => 422', async () => {
    const redis = new FakeRedis();
    const svc = make(redis);
    await lastValueFrom(await svc.intercept(ctx().context, { handle: () => of({ ok: true }) }));
    await expect(svc.intercept(ctx({ body: { a: 2 } }).context, { handle: () => of({}) })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(svc.intercept(ctx({ url: '/otra' }).context, { handle: () => of({}) })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('primera aún en curso => 409', async () => {
    const redis = new FakeRedis();
    const svc = make(redis);
    await svc.intercept(ctx().context, { handle: () => of({ ok: true }) }); // adquiere, sin consumir el observable
    await expect(svc.intercept(ctx().context, { handle: () => of({}) })).rejects.toBeInstanceOf(ConflictException);
  });

  it('otro tenant con la misma clave no choca', async () => {
    const redis = new FakeRedis();
    const svc = make(redis);
    const handler = vi.fn(() => of({ ok: true }));
    await lastValueFrom(await svc.intercept(ctx().context, { handle: handler }));
    await lastValueFrom(
      await svc.intercept(ctx({ user: { tenantId: 'otro', actorId: 'u1' } }).context, { handle: handler }),
    );
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('si el handler falla se libera la clave para reintentar', async () => {
    const redis = new FakeRedis();
    const svc = make(redis);
    const out = await svc.intercept(ctx().context, { handle: () => throwError(() => new Error('boom')) });
    await expect(lastValueFrom(out)).rejects.toThrow('boom');
    expect(redis.store.size).toBe(0);
  });

  it('no guarda respuestas que no son JSON (buffer) ni mayores a 256 KB', async () => {
    const redis = new FakeRedis();
    const svc = make(redis);
    await lastValueFrom(await svc.intercept(ctx().context, { handle: () => of(Buffer.from('pdf')) }));
    expect(redis.store.size).toBe(0);
    await lastValueFrom(await svc.intercept(ctx().context, { handle: () => of({ big: 'x'.repeat(300 * 1024) }) }));
    expect(redis.store.size).toBe(0);
  });

  it('clave insegura => 400', async () => {
    const redis = new FakeRedis();
    await expect(
      make(redis).intercept(ctx({ headers: { 'idempotency-key': 'a b' } }).context, { handle: () => of({}) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Redis caído: deja pasar', async () => {
    const broken = {
      set: async () => {
        throw new Error('down');
      },
    } as unknown as FakeRedis;
    const handler = vi.fn(() => of({ ok: 1 }));
    const out = await make(broken).intercept(ctx().context, { handle: handler });
    expect(await lastValueFrom(out)).toEqual({ ok: 1 });
  });

  it('helpers puros', () => {
    expect(isSafeIdempotencyKey('a'.repeat(100))).toBe(true);
    expect(isSafeIdempotencyKey('a'.repeat(101))).toBe(false);
    expect(isSafeIdempotencyKey('')).toBe(false);
    expect(requestFingerprint('post', '/x', { a: 1 })).toBe(requestFingerprint('POST', '/x', { a: 1 }));
    expect(requestFingerprint('POST', '/x', { a: 1 })).not.toBe(requestFingerprint('POST', '/x', { a: 2 }));
    expect(cacheableBody(undefined)).toEqual({ ok: false });
    expect(cacheableBody({ a: 1 }).ok).toBe(true);
  });
});
