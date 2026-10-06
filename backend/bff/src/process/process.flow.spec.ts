/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProcessService } from './process.service';
import { ProcessController } from './process.controller';
import { ROLES_KEY } from '../auth/roles.decorator';
import type { Flow } from '../flow/flow.types';

const flow: Flow = {
  order: 'SECUENCIAL',
  slaHours: 24,
  variables: [{ key: 'monto', label: 'Monto', type: 'number', required: true }],
  steps: [
    { id: 'a', label: 'Solicitante', who: { type: 'initiator' }, role: 'FIRMANTE' },
    { id: 'b', label: 'Dirección', who: { type: 'fixed', signerId: 'roberto' }, role: 'FIRMANTE', when: [{ variable: 'monto', op: '>=', value: 10000 }] },
  ],
};

function svc(existing: { key: string; version: number; id?: string; published?: boolean }[] = []) {
  const rows = existing.map((r, i) => ({ id: r.id ?? `id${i}`, name: 'N', description: null, bpmnXml: '<x/>', dmnXml: null, decisionRules: null, flow: null, published: true, ...r }));
  const prisma = {
    processDefinition: {
      findFirst: vi.fn(async ({ where, orderBy }: any = {}) => {
        let list = rows.filter((r) => (!where?.key || r.key === where.key) && (where?.version === undefined || r.version === where.version));
        if (orderBy?.version === 'desc') list = [...list].sort((a, b) => b.version - a.version);
        return list[0] ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => !where?.published || r.published)),
      create: vi.fn(async ({ data }: any) => ({ id: 'new', ...data })),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      updateMany: vi.fn(async (a: any) => a),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const redis = { del: vi.fn(async () => undefined), withCache: vi.fn() };
  return { s: new ProcessService(prisma as any, redis as any), prisma };
}

describe('flujos publicables', () => {
  it('createFromFlow genera la clave, el BPMN y nace como borrador', async () => {
    const { s, prisma } = svc();
    await s.createFromFlow({ name: 'Aprobación de Compras Ñandú', flow });
    const data = prisma.processDefinition.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ key: 'aprobacion-de-compras-nandu', version: 1, published: false });
    expect(data.bpmnXml).toContain('<bpmn:userTask');
    expect(data.bpmnXml).toContain('${monto &gt;= 10000}');
    expect(data.flow).toEqual(flow);
  });

  it('si la clave ya existe agrega un sufijo numérico', async () => {
    const { s, prisma } = svc([{ key: 'compras', version: 1 }, { key: 'compras-2', version: 1 }]);
    await s.createFromFlow({ name: 'Compras', flow });
    expect(prisma.processDefinition.create.mock.calls[0]![0].data.key).toBe('compras-3');
  });

  it('un flujo inválido responde 400 con la lista de errores', async () => {
    const { s, prisma } = svc();
    const err: any = await s.createFromFlow({ name: 'Vacío', flow: { ...flow, steps: [] } }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().errors.join()).toMatch(/al menos un paso/);
    expect(prisma.processDefinition.create).not.toHaveBeenCalled();
  });

  it('saveFlow crea la siguiente versión como borrador y regenera el BPMN', async () => {
    const { s, prisma } = svc([{ key: 'compras', version: 2 }]);
    await s.saveFlow('compras', { flow });
    expect(prisma.processDefinition.create.mock.calls[0]![0].data).toMatchObject({ key: 'compras', version: 3, published: false });
    await expect(svc().s.saveFlow('nada', { flow })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('publicar una versión despublica las demás de la misma clave', async () => {
    const { s, prisma } = svc([{ key: 'compras', version: 1 }, { key: 'compras', version: 2, id: 'v2' }]);
    await s.publish('compras', 2);
    expect(prisma.processDefinition.updateMany).toHaveBeenCalledWith({ where: { key: 'compras', version: { not: 2 } }, data: { published: false } });
    expect(prisma.processDefinition.update.mock.calls[0]![0]).toMatchObject({ where: { id: 'v2' }, data: { published: true } });
  });

  it('publicar o despublicar una versión inexistente → 404', async () => {
    const { s } = svc([{ key: 'compras', version: 1 }]);
    await expect(s.publish('compras', 9)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.unpublish('compras', 9)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('no deja publicar una versión cuyo flujo guardado ya no es válido', async () => {
    const { s } = svc([{ key: 'roto', version: 1, ...({ flow: { ...flow, steps: [] } } as object) }]);
    await expect(s.publish('roto', 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listPublished solo trae versiones publicadas', async () => {
    const { s } = svc([{ key: 'a', version: 1, published: true }, { key: 'b', version: 1, published: false }]);
    expect((await s.listPublished()).map((r) => r.key)).toEqual(['a']);
  });

  it('crear, editar y publicar son solo de admin; leer no exige rol', () => {
    const proto = ProcessController.prototype as any;
    for (const fn of ['create', 'saveFlow', 'publish', 'unpublish']) {
      expect(Reflect.getMetadata(ROLES_KEY, proto[fn]), fn).toEqual(['admin']);
    }
    expect(Reflect.getMetadata(ROLES_KEY, proto.list)).toBeUndefined();
  });
});
