/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PLATFORM_TENANT, ProcessService } from './process.service';
import { ProcessController } from './process.controller';
import { ROLES_KEY } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
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

const T1 = 'T1';
const T2 = 'T2';

type Seed = { key: string; version: number; tenantId?: string; id?: string; published?: boolean; flow?: unknown };

/** Mock de Prisma que respeta `tenantId` (valor o `{ in: [...] }`), `key`, `version` y `published`. */
function svc(existing: Seed[] = []) {
  const rows = existing.map((r, i) => ({
    id: r.id ?? `id${i}`, tenantId: T1, name: 'N', description: null, bpmnXml: '<x/>', dmnXml: null, decisionRules: null, flow: null, published: true, ...r,
  }));
  const tenantOk = (w: any, r: any): boolean => w?.OR ? w.OR.some((branch: any) => tenantOk(branch, r)) : !w?.tenantId || (typeof w.tenantId === 'string' ? r.tenantId === w.tenantId : w.tenantId.in.includes(r.tenantId));
  const match = (w: any, r: any) =>
    tenantOk(w, r) && (!w?.key || r.key === w.key) && (w?.version === undefined || r.version === w.version) && (!w?.published || r.published);
  const prisma = {
    processCatalogPreference: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    processDefinition: {
      findFirst: vi.fn(async ({ where, orderBy }: any = {}) => {
        let list = rows.filter((r) => match(where, r));
        if (orderBy?.version === 'desc') list = [...list].sort((a, b) => b.version - a.version);
        return list[0] ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => match(where, r))),
      create: vi.fn(async ({ data }: any) => ({ id: 'new', ...data })),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      updateMany: vi.fn(async (a: any) => a),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const redis = {
    del: vi.fn(async () => undefined),
    withCache: vi.fn(async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader()),
  };
  return { s: new ProcessService(prisma as any, redis as any, {} as any), prisma, redis };
}

describe('flujos publicables', () => {
  it('createFromFlow genera la clave, el BPMN, el dueño y nace como borrador', async () => {
    const { s, prisma } = svc();
    await s.createFromFlow(T1, { name: 'Aprobación de Compras Ñandú', flow });
    const data = prisma.processDefinition.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ tenantId: T1, key: 'aprobacion-de-compras-nandu', version: 1, published: false });
    expect(data.bpmnXml).toContain('<bpmn:userTask');
    expect(data.bpmnXml).toContain('${monto &gt;= 10000}');
    expect(data.flow).toEqual(flow);
  });

  it('si la clave ya existe (propia o de la plataforma) agrega un sufijo numérico', async () => {
    const { s, prisma } = svc([{ key: 'compras', version: 1 }, { key: 'compras-2', version: 1, tenantId: PLATFORM_TENANT }]);
    await s.createFromFlow(T1, { name: 'Compras', flow });
    expect(prisma.processDefinition.create.mock.calls[0]![0].data.key).toBe('compras-3');
  });

  it('la clave de otro tenant no estorba: dos tenants pueden tener «compras»', async () => {
    const { s, prisma } = svc([{ key: 'compras', version: 1, tenantId: T2 }]);
    await s.createFromFlow(T1, { name: 'Compras', flow });
    expect(prisma.processDefinition.create.mock.calls[0]![0].data).toMatchObject({ tenantId: T1, key: 'compras' });
  });

  it('un flujo inválido responde 400 con la lista de errores', async () => {
    const { s, prisma } = svc();
    const err: any = await s.createFromFlow(T1, { name: 'Vacío', flow: { ...flow, steps: [] } }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().errors.join()).toMatch(/al menos un paso/);
    expect(prisma.processDefinition.create).not.toHaveBeenCalled();
  });

  it('saveFlow crea la siguiente versión propia como borrador y regenera el BPMN', async () => {
    const { s, prisma } = svc([{ key: 'compras', version: 2 }]);
    await s.saveFlow('compras', T1, { flow });
    expect(prisma.processDefinition.create.mock.calls[0]![0].data).toMatchObject({ tenantId: T1, key: 'compras', version: 3, published: false });
    await expect(svc().s.saveFlow('nada', T1, { flow })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('saveFlow sobre una definición de la plataforma crea la copia propia, versión 1', async () => {
    const { s, prisma } = svc([{ key: 'contrato-dos-partes', version: 4, tenantId: PLATFORM_TENANT }]);
    await s.saveFlow('contrato-dos-partes', T1, { flow });
    expect(prisma.processDefinition.create.mock.calls[0]![0].data).toMatchObject({ tenantId: T1, key: 'contrato-dos-partes', version: 1, published: false });
  });

  it('saveFlow sobre un flujo de OTRO tenant responde 404 y no crea nada', async () => {
    const { s, prisma } = svc([{ key: 'privado', version: 1, tenantId: T2 }]);
    await expect(s.saveFlow('privado', T1, { flow })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.processDefinition.create).not.toHaveBeenCalled();
  });

  it('publicar una versión despublica solo las demás del mismo tenant y clave', async () => {
    const { s, prisma } = svc([{ key: 'compras', version: 1, flow }, { key: 'compras', version: 2, id: 'v2', flow }]);
    await s.publish('compras', 2, T1);
    expect(prisma.processDefinition.updateMany).toHaveBeenCalledWith({ where: { tenantId: T1, key: 'compras', version: { not: 2 } }, data: { published: false } });
    expect(prisma.processDefinition.update.mock.calls[0]![0]).toMatchObject({ where: { id: 'v2' }, data: { published: true } });
  });

  it('publicar o despublicar algo de la plataforma es 403 y algo de otro tenant es 404', async () => {
    const { s, prisma } = svc([
      { key: 'contrato-dos-partes', version: 1, tenantId: PLATFORM_TENANT },
      { key: 'ajeno', version: 1, tenantId: T2 },
    ]);
    await expect(s.publish('contrato-dos-partes', 1, T1)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.unpublish('contrato-dos-partes', 1, T1)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.publish('ajeno', 1, T1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.unpublish('ajeno', 1, T1)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.processDefinition.update).not.toHaveBeenCalled();
    expect(prisma.processDefinition.updateMany).not.toHaveBeenCalled();
  });

  it('publicar o despublicar una versión inexistente → 404', async () => {
    const { s } = svc([{ key: 'compras', version: 1 }]);
    await expect(s.publish('compras', 9, T1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.unpublish('compras', 9, T1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('no deja publicar una versión cuyo flujo guardado ya no es válido', async () => {
    const { s } = svc([{ key: 'roto', version: 1, flow: { ...flow, steps: [] } }]);
    await expect(s.publish('roto', 1, T1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listPublished trae solo publicadas, propias y de la plataforma, nunca las de otro tenant', async () => {
    const { s } = svc([
      { key: 'a', version: 1, published: true },
      { key: 'b', version: 1, published: false },
      { key: 'p', version: 1, published: true, tenantId: PLATFORM_TENANT },
      { key: 'ajena', version: 1, published: true, tenantId: T2 },
    ]);
    expect((await s.listPublished(T1)).map((r) => r.key).sort()).toEqual(['a', 'p']);
  });

  it('list consulta con el tenant y cachea con una clave por tenant', async () => {
    const { s, prisma, redis } = svc([{ key: 'a', version: 1 }, { key: 'ajena', version: 1, tenantId: T2 }]);
    const out = (await s.list(T1)) as { key: string }[];
    expect(out.map((r) => r.key)).toEqual(['a']);
    expect(redis.withCache.mock.calls[0]![0]).toBe(`process:list:${T1}`);
    expect(prisma.processDefinition.findMany.mock.calls[0]![0].where).toEqual({ OR: [{ tenantId: T1 }, { tenantId: PLATFORM_TENANT }] });
  });

  it('getLatest: lo propio tapa a la plataforma, lo ajeno no existe y la caché lleva el tenant', async () => {
    const { s, redis } = svc([
      { key: 'x', version: 1, tenantId: PLATFORM_TENANT },
      { key: 'x', version: 3, tenantId: T1 },
      { key: 'solo-t2', version: 1, tenantId: T2 },
    ]);
    expect((await s.getLatest('x', T1)).tenantId).toBe(T1);
    expect((await s.getLatest('x', T2)).tenantId).toBe(PLATFORM_TENANT);
    await expect(s.getLatest('solo-t2', T1)).rejects.toBeInstanceOf(NotFoundException);
    expect(redis.withCache.mock.calls.map((c: any[]) => c[0])).toContain(`process:latest:${T1}:x`);
  });

  it('saveXml sobre la plataforma crea la copia propia y sobre lo propio sube la versión', async () => {
    const forked = svc([{ key: 'onboarding-identidad', version: 2, tenantId: PLATFORM_TENANT }]);
    await forked.s.saveXml('onboarding-identidad', T1, { bpmnXml: '<nuevo/>' });
    expect(forked.prisma.processDefinition.create.mock.calls[0]![0].data).toMatchObject({ tenantId: T1, version: 1, bpmnXml: '<nuevo/>' });

    const own = svc([{ key: 'k', version: 5 }]);
    await own.s.saveXml('k', T1, { bpmnXml: '<v6/>' });
    expect(own.prisma.processDefinition.create.mock.calls[0]![0].data).toMatchObject({ tenantId: T1, version: 6 });
  });

  it('las escrituras limpian la caché del tenant y no la de otros', async () => {
    const { s, redis } = svc([{ key: 'compras', version: 1 }]);
    await s.saveFlow('compras', T1, { flow });
    expect(redis.del).toHaveBeenCalledWith(`process:list:${T1}`, `process:latest:${T1}:compras`);
  });

  it('crear, editar y publicar son solo de admin; leer no exige rol', () => {
    const proto = ProcessController.prototype as any;
    for (const fn of ['create', 'saveFlow', 'publish', 'unpublish', 'save', 'validateFlow', 'fromBpmn']) {
      expect(Reflect.getMetadata(ROLES_KEY, proto[fn]), fn).toEqual(['admin']);
    }
    expect(Reflect.getMetadata(ROLES_KEY, proto.list)).toBeUndefined();
  });

  it('el controlador pasa siempre el tenant del usuario autenticado', async () => {
    const process = {
      list: vi.fn(), listPublished: vi.fn(), createFromFlow: vi.fn(), saveFlow: vi.fn(), publish: vi.fn(),
      unpublish: vi.fn(), getLatest: vi.fn(async () => ({ bpmnXml: '', key: 'k', version: 1, name: 'n' })), saveXml: vi.fn(), decide: vi.fn(),
    };
    const c = new ProcessController(process as any, {} as any);
    const u = { tenantId: 'TX', roles: ['admin'] } as AuthenticatedUser;
    await c.list({} as any, u);
    await c.list({ published: 'true' } as any, u);
    await c.create({ name: 'n', flow } as any, u);
    await c.saveFlow('k', { flow } as any, u);
    await c.publish('k', 1, u);
    await c.unpublish('k', 1, u);
    await c.get('k', u);
    await c.bpmn('k', u);
    await c.save('k', {}, u);
    await c.decide('k', { tipo: 'x' } as any, u);
    expect(process.list).toHaveBeenCalledWith('TX', expect.anything());
    expect(process.listPublished).toHaveBeenCalledWith('TX');
    expect(process.createFromFlow).toHaveBeenCalledWith('TX', expect.anything());
    expect(process.saveFlow).toHaveBeenCalledWith('k', 'TX', expect.anything());
    expect(process.publish).toHaveBeenCalledWith('k', 1, 'TX');
    expect(process.unpublish).toHaveBeenCalledWith('k', 1, 'TX');
    expect(process.getLatest).toHaveBeenCalledWith('k', 'TX');
    expect(process.saveXml).toHaveBeenCalledWith('k', 'TX', {});
    expect(process.decide).toHaveBeenCalledWith(expect.anything(), 'k', 'TX');
  });
});
