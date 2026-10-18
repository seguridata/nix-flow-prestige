import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CasesService } from './cases.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { FoldersService } from '../folders/folders.service';

function make() {
  const findMany = vi.fn(async (_args: unknown) => []);
  const findFirst = vi.fn(async (_args: unknown) => null);
  const prisma = { case: { findMany, findFirst } } as unknown as PrismaService;
  return { svc: new CasesService(prisma, {} as FoldersService), findMany, findFirst };
}

describe('CasesService: el tenant es obligatorio y siempre filtra', () => {
  it('list filtra por tenant', async () => {
    const { svc, findMany } = make();
    await svc.list('acme');
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: 'acme' } });
  });

  it('list sin tenant (undefined/vacío) devuelve vacío y NO consulta (Prisma ignora tenantId: undefined)', async () => {
    const { svc, findMany } = make();
    expect(await svc.list(undefined as unknown as string)).toEqual([]);
    expect(await svc.list('')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('find y getOrThrow con tenant vacío fallan cerrado sin consultar la base', async () => {
    const { svc, findFirst } = make();
    expect(await svc.find('c1', '')).toBeNull();
    await expect(svc.getOrThrow('c1', undefined as unknown as string)).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('find filtra por id y tenant', async () => {
    const { svc, findFirst } = make();
    await svc.find('c1', 'acme');
    expect(findFirst.mock.calls[0][0]).toEqual({ where: { id: 'c1', tenantId: 'acme' } });
  });

  it('findManyByIds con tenant vacío devuelve vacío sin consultar; con tenant lo incluye en el where', async () => {
    const { svc, findMany } = make();
    expect((await svc.findManyByIds(['c1'], '')).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    await svc.findManyByIds(['c1', 'c1'], 'acme');
    expect(findMany.mock.calls[0][0]).toEqual({ where: { id: { in: ['c1'] }, tenantId: 'acme' } });
  });
});
