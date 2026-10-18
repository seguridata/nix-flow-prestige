/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ProcessService } from './process.service';
import { ADQUISICIONES_FLOW, PROVEEDORES_ESTRATEGICOS_FLOW, RENOVACION_LICENCIAS_FLOW } from './adquisiciones.flows';

describe('ProcessService.ensureSeeds - idempotente con arranques paralelos', () => {
  it('ignora P2002 si otra réplica creó la semilla entre el findFirst y el create', async () => {
    const create = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    });
    const prisma = { processDefinition: { findFirst: vi.fn(async () => null), create } };
    const s = new ProcessService(prisma as any, {} as any, {} as any);
    await expect(s.ensureSeeds()).resolves.toBeUndefined();
    expect(create).toHaveBeenCalled();
  });

  it('las semillas nacen en la plataforma, nunca en un tenant', async () => {
    const create = vi.fn(async () => ({}));
    const findFirst = vi.fn(async () => null);
    await new ProcessService({ processDefinition: { findFirst, create } } as any, {} as any, {} as any).ensureSeeds();
    expect(findFirst.mock.calls.every((c: any[]) => c[0].where.tenantId === 'platform')).toBe(true);
    expect(create.mock.calls.every((c: any[]) => c[0].data.tenantId === 'platform')).toBe(true);
    expect(create).toHaveBeenCalledTimes(5); // contrato, onboarding y los tres de Adquisiciones
  });

  it('propaga otros errores', async () => {
    const prisma = {
      processDefinition: { findFirst: vi.fn(async () => null), create: vi.fn(async () => { throw new Error('boom'); }) },
    };
    await expect(new ProcessService(prisma as any, {} as any, {} as any).ensureSeeds()).rejects.toThrow('boom');
  });

  it('no crea si ya existe', async () => {
    const create = vi.fn();
    // Con el flujo igual al sembrado (o sin flujo sembrado) no hay nada que agregar.
    const flows: Record<string, unknown> = {
      'adquisiciones-gastos': ADQUISICIONES_FLOW,
      'renovacion-licenciamiento': RENOVACION_LICENCIAS_FLOW,
      'proveedores-estrategicos': PROVEEDORES_ESTRATEGICOS_FLOW,
    };
    const prisma = { processDefinition: { findFirst: vi.fn(async ({ where }: any) => ({ id: 'x', version: 1, flow: flows[where.key] ?? null })), create } };
    await new ProcessService(prisma as any, {} as any, {} as any).ensureSeeds();
    expect(create).not.toHaveBeenCalled();
  });
});
