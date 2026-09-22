import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DEFAULT_SIGNATURE_POLICY, SignaturePolicyService } from './signature-policy';
import type { PrismaService } from '../prisma/prisma.service';

function svcWith(policyRow: unknown) {
  const prisma = {
    policy: { findFirst: async () => policyRow },
  } as unknown as PrismaService;
  return new SignaturePolicyService(prisma);
}

describe('SignaturePolicyService (M10)', () => {
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
