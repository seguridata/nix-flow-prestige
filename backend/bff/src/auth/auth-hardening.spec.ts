import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard, assertAudience } from './jwt-auth.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { WorkerGuard } from './worker.guard';
import { WORKER_TOKEN_HEADER, WORKER_TS_HEADER, signWorkerRequest } from './worker-signature';

const ISSUER = 'http://kc.test/realms/prestige';
let privateKey: CryptoKey;

vi.mock('jose', async (orig) => {
  const actual = await orig<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: () => (...args: unknown[]) =>
      (globalThis as { __jwks?: (...a: unknown[]) => unknown }).__jwks!(...args),
  };
});

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  (globalThis as { __jwks?: unknown }).__jwks = createLocalJWKSet({ keys: [jwk] });
});

const token = (claims: Record<string, unknown>) =>
  new SignJWT({ preferred_username: 'maria', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setSubject('sub-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

function ctx(request: Record<string, unknown>, meta: Record<string, unknown> = {}) {
  const reflector = { getAllAndOverride: (k: string) => meta[k] } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { reflector, context };
}

describe('JwtAuthGuard — tenant y audiencia', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('sin claim tenant => 401 (sin default seguridata)', async () => {
    process.env.KEYCLOAK_ISSUER = ISSUER;
    const { reflector, context } = ctx({ headers: { authorization: 'Bearer ' + (await token({})) } });
    await expect(new JwtAuthGuard(reflector).canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('con claim tenant arma el usuario', async () => {
    process.env.KEYCLOAK_ISSUER = ISSUER;
    const jwt = await token({ tenant: 'acme', realm_access: { roles: ['signer'] } });
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer ' + jwt } };
    const { reflector, context } = ctx(req);
    await expect(new JwtAuthGuard(reflector).canActivate(context)).resolves.toBe(true);
    expect(req.user).toMatchObject({ tenantId: 'acme', actorId: 'maria', roles: ['signer'] });
  });

  it('KEYCLOAK_AUDIENCE definida: exige aud o azp', async () => {
    process.env.KEYCLOAK_ISSUER = ISSUER;
    process.env.KEYCLOAK_AUDIENCE = 'prestige-web';
    const badJwt = await token({ tenant: 'acme', azp: 'otro' });
    const bad = ctx({ headers: { authorization: 'Bearer ' + badJwt } });
    await expect(new JwtAuthGuard(bad.reflector).canActivate(bad.context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const okJwt = await token({ tenant: 'acme', azp: 'prestige-web' });
    const ok = ctx({ headers: { authorization: 'Bearer ' + okJwt } });
    await expect(new JwtAuthGuard(ok.reflector).canActivate(ok.context)).resolves.toBe(true);
  });

  it('assertAudience acepta aud como arreglo y no actúa sin env', () => {
    process.env.KEYCLOAK_AUDIENCE = 'x';
    expect(() => assertAudience({ aud: ['a', 'x'] })).not.toThrow();
    expect(() => assertAudience({ aud: 'a' })).toThrow(UnauthorizedException);
    delete process.env.KEYCLOAK_AUDIENCE;
    expect(() => assertAudience({})).not.toThrow();
  });
});

describe('TenantContextGuard — fail-closed', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const prismaWith = (rows: unknown[]) => ({ tenantMembership: { findMany: async () => rows } }) as never;
  const req = () => ({ user: { actorId: 'maria', sub: 's', tenantId: 'acme', roles: [] }, headers: {} });

  it('sin membresías => 403', async () => {
    delete process.env.ALLOW_UNMAPPED_TENANT;
    const { reflector, context } = ctx(req());
    await expect(new TenantContextGuard(reflector, prismaWith([])).canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('ALLOW_UNMAPPED_TENANT=true solo cuenta fuera de producción', async () => {
    process.env.ALLOW_UNMAPPED_TENANT = 'true';
    process.env.NODE_ENV = 'development';
    const dev = ctx(req());
    await expect(new TenantContextGuard(dev.reflector, prismaWith([])).canActivate(dev.context)).resolves.toBe(true);
    process.env.NODE_ENV = 'production';
    const prod = ctx(req());
    await expect(new TenantContextGuard(prod.reflector, prismaWith([])).canActivate(prod.context)).rejects.toThrow();
  });

  it('con membresía coincidente fija el slug del tenant', async () => {
    const r = req();
    const { reflector, context } = ctx(r);
    const rows = [{ tenantId: 't1', tenant: { id: 't1', slug: 'acme', active: true } }];
    await expect(new TenantContextGuard(reflector, prismaWith(rows)).canActivate(context)).resolves.toBe(true);
    expect(r.user.tenantId).toBe('acme');
  });
});

describe('WorkerGuard — HMAC con método+path+ts y anti-replay', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const SECRET = 's3cret';
  const make = (opts: { path?: string; ts?: number }) => {
    const body = { signatureRequestId: 'sr-1' };
    const { ts, token: sig } = signWorkerRequest(SECRET, {
      method: 'POST',
      path: '/internal/workflows/expire',
      body,
      ts: opts.ts,
    });
    return ctx({
      method: 'POST',
      originalUrl: opts.path ?? '/internal/workflows/expire',
      body,
      headers: { [WORKER_TOKEN_HEADER]: sig, [WORKER_TS_HEADER]: ts },
    });
  };

  it('acepta una firma válida y rechaza su replay', () => {
    process.env.WORKER_SHARED_SECRET = SECRET;
    const guard = new WorkerGuard();
    const { context } = make({ ts: Date.now() });
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(/ya utilizada/);
  });

  it('rechaza timestamp fuera de la ventana de 60 s', () => {
    process.env.WORKER_SHARED_SECRET = SECRET;
    expect(() => new WorkerGuard().canActivate(make({ ts: Date.now() - 61_000 }).context)).toThrow(
      UnauthorizedException,
    );
  });

  it('la firma está atada al path y al body', () => {
    process.env.WORKER_SHARED_SECRET = SECRET;
    expect(() =>
      new WorkerGuard().canActivate(make({ path: '/internal/workflows/seal-evidence' }).context),
    ).toThrow(/inválida/);
    const { context } = make({});
    (context.switchToHttp().getRequest() as { body: unknown }).body = { signatureRequestId: 'otro' };
    expect(() => new WorkerGuard().canActivate(context)).toThrow(/inválida/);
  });

  it('sin secreto o sin cabeceras => 401', () => {
    delete process.env.WORKER_SHARED_SECRET;
    expect(() => new WorkerGuard().canActivate(make({}).context)).toThrow(UnauthorizedException);
    process.env.WORKER_SHARED_SECRET = SECRET;
    expect(() => new WorkerGuard().canActivate(ctx({ method: 'POST', headers: {} }).context)).toThrow(
      UnauthorizedException,
    );
  });
});
