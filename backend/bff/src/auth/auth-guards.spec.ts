import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';
import { STEP_UP_KEY } from './step-up.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { StepUpGuard } from './step-up.guard';

function contextFor(opts: {
  metadata: Record<string, unknown>;
  user?: Partial<AuthenticatedUser>;
  authorization?: string;
}) {
  const request: { user?: Partial<AuthenticatedUser>; headers: { authorization?: string } } = {
    user: opts.user,
    headers: { authorization: opts.authorization },
  };
  const reflector = {
    getAllAndOverride: (key: string) => opts.metadata[key],
  } as unknown as Reflector;
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { reflector, ctx, request };
}

describe('JwtAuthGuard', () => {
  const issuer = process.env.KEYCLOAK_ISSUER;

  afterEach(() => {
    if (issuer === undefined) delete process.env.KEYCLOAK_ISSUER;
    else process.env.KEYCLOAK_ISSUER = issuer;
  });

  it('deja pasar una ruta @Public() sin token', async () => {
    const { reflector, ctx } = contextFor({ metadata: { [IS_PUBLIC_KEY]: true } });
    const guard = new JwtAuthGuard(reflector);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rechaza la ausencia de Bearer', async () => {
    process.env.KEYCLOAK_ISSUER = 'http://127.0.0.1:9/realms/prestige';
    const { reflector, ctx } = contextFor({ metadata: {} });
    const guard = new JwtAuthGuard(reflector);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token que no es un JWT', async () => {
    process.env.KEYCLOAK_ISSUER = 'http://127.0.0.1:9/realms/prestige';
    const { reflector, ctx } = contextFor({ metadata: {}, authorization: 'Bearer esto-no-es-un-jwt' });
    const guard = new JwtAuthGuard(reflector);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('RolesGuard', () => {
  it('deja pasar @Public() y las rutas sin @Roles()', () => {
    const pub = contextFor({ metadata: { [IS_PUBLIC_KEY]: true, [ROLES_KEY]: ['admin'] } });
    expect(new RolesGuard(pub.reflector).canActivate(pub.ctx)).toBe(true);
    const open = contextFor({ metadata: {}, user: { roles: [] } });
    expect(new RolesGuard(open.reflector).canActivate(open.ctx)).toBe(true);
  });

  it('rechaza un rol insuficiente y acepta uno de los exigidos', () => {
    const denied = contextFor({
      metadata: { [ROLES_KEY]: ['admin', 'rh'] },
      user: { roles: ['signer'] },
    });
    expect(() => new RolesGuard(denied.reflector).canActivate(denied.ctx)).toThrow(ForbiddenException);
    const allowed = contextFor({
      metadata: { [ROLES_KEY]: ['admin', 'rh'] },
      user: { roles: ['rh'] },
    });
    expect(new RolesGuard(allowed.reflector).canActivate(allowed.ctx)).toBe(true);
  });
});

describe('StepUpGuard', () => {
  const enforce = process.env.STEP_UP_ENFORCE;

  afterEach(() => {
    if (enforce === undefined) delete process.env.STEP_UP_ENFORCE;
    else process.env.STEP_UP_ENFORCE = enforce;
  });

  it('no actúa en @Public() ni en rutas sin @StepUp()', () => {
    const pub = contextFor({ metadata: { [IS_PUBLIC_KEY]: true, [STEP_UP_KEY]: 60 } });
    expect(new StepUpGuard(pub.reflector).canActivate(pub.ctx)).toBe(true);
    const plain = contextFor({ metadata: {}, user: {} });
    expect(new StepUpGuard(plain.reflector).canActivate(plain.ctx)).toBe(true);
  });

  it('rechaza una autenticación más vieja que el máximo y acepta una reciente', () => {
    const now = Math.floor(Date.now() / 1000);
    const stale = contextFor({
      metadata: { [STEP_UP_KEY]: 300 },
      user: { authTime: now - 301 },
    });
    expect(() => new StepUpGuard(stale.reflector).canActivate(stale.ctx)).toThrow(ForbiddenException);
    try {
      new StepUpGuard(stale.reflector).canActivate(stale.ctx);
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({ error: 'step_up_required' });
    }
    const fresh = contextFor({
      metadata: { [STEP_UP_KEY]: 300 },
      user: { authTime: now - 10 },
    });
    expect(new StepUpGuard(fresh.reflector).canActivate(fresh.ctx)).toBe(true);
  });

  it('sin auth_time exige step-up solo si STEP_UP_ENFORCE=true', () => {
    const missing = contextFor({ metadata: { [STEP_UP_KEY]: 300 }, user: {} });
    delete process.env.STEP_UP_ENFORCE;
    expect(new StepUpGuard(missing.reflector).canActivate(missing.ctx)).toBe(true);
    process.env.STEP_UP_ENFORCE = 'true';
    expect(() => new StepUpGuard(missing.reflector).canActivate(missing.ctx)).toThrow(ForbiddenException);
  });
});
