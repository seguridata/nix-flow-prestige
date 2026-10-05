/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ProcessService } from './process.service';

describe('ProcessService.ensureSeeds - idempotente con arranques paralelos', () => {
  it('ignora P2002 si otra réplica creó la semilla entre el findFirst y el create', async () => {
    const create = vi.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    });
    const prisma = { processDefinition: { findFirst: vi.fn(async () => null), create } };
    const s = new ProcessService(prisma as any, {} as any);
    await expect(s.ensureSeeds()).resolves.toBeUndefined();
    expect(create).toHaveBeenCalled();
  });

  it('propaga otros errores', async () => {
    const prisma = {
      processDefinition: { findFirst: vi.fn(async () => null), create: vi.fn(async () => { throw new Error('boom'); }) },
    };
    await expect(new ProcessService(prisma as any, {} as any).ensureSeeds()).rejects.toThrow('boom');
  });

  it('no crea si ya existe', async () => {
    const create = vi.fn();
    const prisma = { processDefinition: { findFirst: vi.fn(async () => ({ id: 'x' })), create } };
    await new ProcessService(prisma as any, {} as any).ensureSeeds();
    expect(create).not.toHaveBeenCalled();
  });
});
