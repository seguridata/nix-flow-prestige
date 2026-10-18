import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DEFAULT_SIGNATURE_POLICY, SIGNATURE_POLICY_KEY, SignaturePolicyService } from './signature-policy';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantIdResolver } from '../prisma/tenant-id-resolver';

const TENANT_UUID = '11111111-2222-3333-4444-555555555555';

function svcWith(policyRow: unknown, tenantUuid: string | null = TENANT_UUID) {
  const findUnique = vi.fn(async (_args: unknown) => policyRow);
  const prisma = { policy: { findUnique } } as unknown as PrismaService;
  const tenantIds = { toId: vi.fn(async () => tenantUuid) } as unknown as TenantIdResolver;
  return Object.assign(new SignaturePolicyService(prisma, tenantIds), { findUnique, tenantIds });
}

describe('SignaturePolicyService (M10)', () => {
  it('consulta la unique (tenantId_key) con el UUID del tenant, no con el slug', async () => {
    const s = svcWith({ version: 1, value: {} });
    await s.resolve('seguridata');
    expect(s.tenantIds.toId).toHaveBeenCalledWith('seguridata');
    expect(s.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: TENANT_UUID, key: SIGNATURE_POLICY_KEY } },
    });
  });

  it('tenant inexistente: política por defecto y sin consultar Policy', async () => {
    const s = svcWith({ version: 9, value: {} }, null);
    expect(await s.resolve('fantasma')).toEqual(DEFAULT_SIGNATURE_POLICY);
    expect(s.findUnique).not.toHaveBeenCalled();
  });

  it('sin fila de Policy devuelve la política por defecto (version 0)', async () => {
    const p = await svcWith(null).resolve('seguridata');
    expect(p).toEqual(DEFAULT_SIGNATURE_POLICY);
  });

  it('fusiona la fila del tenant sobre el default y conserva la versión', async () => {
    const p = await svcWith({
      version: 3,
      value: { allowedMethods: ['DIGITAL'], defaultSlaHours: 24, requireTimestamp: false },
    }).resolve('seguridata');
    expect(p).toMatchObject({
      version: 3,
      source: 'tenant',
      allowedMethods: ['DIGITAL'],
      defaultSlaHours: 24,
      requireTimestamp: false,
      defaultOrder: 'SECUENCIAL', // no venía en value → default
    });
  });

  it('enforce rechaza métodos fuera de la política', () => {
    const s = svcWith(null);
    expect(() =>
      s.enforce({ ...DEFAULT_SIGNATURE_POLICY, version: 3, allowedMethods: ['DIGITAL'] }, {
        methods: ['DIGITAL', 'AUTOGRAFA'],
      }),
    ).toThrow(BadRequestException);
  });

  it('enforce aplica defaults de order y sla cuando la solicitud no los da', () => {
    const s = svcWith(null);
    const out = s.enforce(
      { ...DEFAULT_SIGNATURE_POLICY, defaultOrder: 'PARALELO', defaultSlaHours: 12 },
      { methods: ['DIGITAL'] },
    );
    expect(out).toEqual({ order: 'PARALELO', slaHours: 12 });
  });
});
