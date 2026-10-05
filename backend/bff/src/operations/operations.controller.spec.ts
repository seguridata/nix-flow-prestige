/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { OperationsController } from './operations.controller';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';

const userA = { tenantId: 'A' } as AuthenticatedUser;
const userB = { tenantId: 'B' } as AuthenticatedUser;

function setup(ping: () => Promise<boolean> = async () => true) {
  const mk = () => ({
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
  });
  const prisma = {
    signatureRequest: mk(),
    humanTask: mk(),
    workflowRun: mk(),
    onboardingCase: mk(),
    document: mk(),
    processAuditEvent: mk(),
    $queryRaw: vi.fn().mockResolvedValue([1]),
  };
  const signing = { capabilities: () => [{ method: 'BIOMETRICA' }] };
  const storage = { enabled: true, ping: vi.fn(ping) };
  const ctrl = new OperationsController(prisma as any, signing as any, storage as any);
  return { prisma, ctrl };
}

function allCalls(prisma: Record<string, any>) {
  const out: { model: string; method: string; arg: any }[] = [];
  for (const [model, t] of Object.entries(prisma)) {
    if (model.startsWith('$')) continue;
    for (const method of ['count', 'groupBy', 'findMany']) {
      for (const c of t[method].mock.calls) out.push({ model, method, arg: c[0] });
    }
  }
  return out;
}

describe('OperationsController - aislamiento por tenant', () => {
  it('summary/overview filtran TODAS las consultas por tenantId', async () => {
    const { prisma, ctrl } = setup();
    await ctrl.summary(userA);
    await ctrl.overview(userA);
    const calls = allCalls(prisma);
    expect(calls.length).toBeGreaterThanOrEqual(12);
    for (const c of calls) expect(c.arg?.where?.tenantId, c.model + '.' + c.method).toBe('A');
  });

  it('search filtra Document, OnboardingCase y SignatureRequest por tenant', async () => {
    const { prisma, ctrl } = setup();
    await ctrl.search('juan', userB);
    const calls = allCalls(prisma);
    expect(calls.map((c) => c.model).sort()).toEqual(['document', 'onboardingCase', 'signatureRequest']);
    for (const c of calls) expect(c.arg.where.tenantId).toBe('B');
  });

  it('search con termino corto no consulta nada', async () => {
    const { prisma, ctrl } = setup();
    expect(await ctrl.search('a', userA)).toEqual({ documents: [], onboarding: [], requests: [] });
    expect(allCalls(prisma)).toHaveLength(0);
  });

  it('health (publico) no expone REDIS_URL ni TEMPORAL_ADDRESS', async () => {
    process.env.REDIS_URL = 'redis://user:secret@host:6379';
    process.env.TEMPORAL_ADDRESS = 'temporal.internal:7233';
    const { ctrl } = setup();
    const res = JSON.stringify(await ctrl.health());
    expect(res).not.toContain('secret');
    expect(res).not.toContain('temporal.internal');
    expect(res).not.toContain('redis://');
    delete process.env.REDIS_URL;
    delete process.env.TEMPORAL_ADDRESS;
  });

  it('health: objectStorage true si el ping al bucket responde', async () => {
    const { ctrl } = setup(async () => true);
    expect((await ctrl.health()).objectStorage).toBe(true);
  });

  it('health: objectStorage false (sin romper) si el ping falla, sin filtrar el error', async () => {
    const { ctrl } = setup(async () => {
      throw new Error('getaddrinfo ENOTFOUND s3.interno secret-key');
    });
    const body = await ctrl.health();
    expect(body.objectStorage).toBe(false);
    expect(body.postgres).toBe(true);
    const res = JSON.stringify(body);
    expect(res).not.toContain('ENOTFOUND');
    expect(res).not.toContain('REDIS_URL');
  });

  it('health: objectStorage false si no esta configurado', async () => {
    const { ctrl } = setup(async () => false);
    expect((await ctrl.health()).objectStorage).toBe(false);
  });
});
