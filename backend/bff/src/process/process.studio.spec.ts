/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProcessService } from './process.service';
import { ProcessController } from './process.controller';
import { ROLES_KEY } from '../auth/roles.decorator';
import type { Flow } from '../flow/flow.types';

const flow: Flow = {
  variables: [], order: 'SECUENCIAL', slaHours: 24,
  steps: [{ id: 'review', label: 'Revisar', who: { type: 'initiator' }, role: 'REVISOR' }],
};
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1', key: 'gastos', tenantId: 'A', version: 1, name: 'Gastos', description: null,
  flow, bpmnXml: '<xml/>', dmnXml: null, decisionRules: null, published: false, ...overrides,
});

function setup(definitions = [row()], hidden: string[] = []) {
  const match = (r: any, w: any): boolean => {
    if (w.OR && !w.OR.some((branch: any) => match(r, branch))) return false;
    if (w.tenantId && r.tenantId !== w.tenantId) return false;
    if (typeof w.key === 'string' && r.key !== w.key) return false;
    if (w.key?.notIn?.includes(r.key)) return false;
    if (w.version !== undefined && r.version !== w.version) return false;
    if (w.published !== undefined && r.published !== w.published) return false;
    return true;
  };
  const prisma = {
    processDefinition: {
      findFirst: vi.fn(async ({ where }: any) => definitions.filter((r) => match(r, where)).sort((a, b) => b.version - a.version)[0] ?? null),
      findMany: vi.fn(async ({ where }: any) => definitions.filter((r) => match(r, where)).sort((a, b) => b.version - a.version)),
      create: vi.fn(async ({ data }: any) => ({ id: 'new', ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async ({ data }: any) => data),
    },
    processCatalogPreference: {
      findMany: vi.fn(async ({ where }: any) => where.tenantId === 'A' ? hidden.map((key) => ({ key })) : []),
      findFirst: vi.fn(async ({ where }: any) => where.tenantId === 'A' && hidden.includes(where.key) ? { key: where.key } : null),
      upsert: vi.fn(async (args: any) => args.create),
    },
    lookupTable: { findMany: vi.fn(async () => []) },
    workflowRun: { groupBy: vi.fn(async () => [{ status: 'ACTIVO', _count: { _all: 2 } }, { status: 'COMPLETADO', _count: { _all: 5 } }]) },
    documentTemplate: { groupBy: vi.fn(async () => [{ flowVersion: 1, _count: { _all: 3 } }]) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const redis = { withCache: vi.fn(async (_k: string, _t: number, loader: () => Promise<unknown>) => loader()), del: vi.fn(async () => undefined) };
  const resolver = { resolve: vi.fn(async (_flow: Flow, values: unknown, _tenant: string, options: any) => ({
    values: { ...(values as object), solicitante: options.solicitante },
    resolved: flow.steps.map((step) => ({ step, active: true })), picks: new Map(), awaiting: new Map(), steps: [], derived: [],
  })) };
  return { prisma, redis, resolver, service: new ProcessService(prisma as any, redis as any, resolver as any) };
}

describe('Estudio de procesos: catálogo, versiones y archivo seguro', () => {
  it('agrupa por clave, prioriza dueño propio y oculta archivados solo en su tenant', async () => {
    const { service } = setup([
      row({ tenantId: 'platform', version: 9 }), row({ version: 2 }), row(),
      row({ key: 'archivado' }), row({ key: 'ajeno', tenantId: 'B' }),
    ], ['archivado']);
    expect(await service.catalog('A')).toMatchObject([{ key: 'gastos', version: 2, versionCount: 2, source: 'tenant' }]);
    expect(await service.catalog('B')).toHaveLength(2);
  });

  it('el historial propio no mezcla números de versión de plataforma y responde404 a ajenas', async () => {
    const { service } = setup([row(), row({ tenantId: 'platform', version: 7 }), row({ key: 'ajeno', tenantId: 'B' })]);
    expect(await service.versions('gastos', 'A')).toHaveLength(1);
    await expect(service.getVersion('gastos', 7, 'A')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.versions('ajeno', 'A')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archivar oculta por tenant, despublica solo lo propio y conserva todas las definiciones', async () => {
    const { service, prisma } = setup([row({ tenantId: 'platform' })]);
    await expect(service.archive('gastos', 'A')).resolves.toEqual({ key: 'gastos', archived: true });
    expect(prisma.processCatalogPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_key: { tenantId: 'A', key: 'gastos' } } }));
    expect(prisma.processDefinition.updateMany).toHaveBeenCalledWith({ where: { tenantId: 'A', key: 'gastos' }, data: { published: false, publishedAt: null } });
  });

  it('restaurar crea versión nueva borrador y reabre preferencia, sin sobrescribir original', async () => {
    const { service, prisma } = setup([row(), row({ version: 4 })], ['gastos']);
    expect(await service.restore('gastos', 1, 'A')).toMatchObject({ version: 5, published: false, flow });
    expect(prisma.processCatalogPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { archivedAt: null } }));
    expect(prisma.processDefinition.update).not.toHaveBeenCalled();
  });

  it('la copia borrador propia oculta la publicada de plataforma en el selector de solicitudes', async () => {
    const { service } = setup([row(), row({ tenantId: 'platform', published: true, version: 3 })]);
    expect(await service.listPublished('A')).toEqual([]);
  });
});

describe('Comprobación previa y recorrido real', () => {
  it('reporta flujo válido y bloquea archivado aunque tenga estructura válida', async () => {
    const visible = setup();
    expect(await visible.service.preflight('gastos', 'A')).toMatchObject({ ready: true, valid: true, errors: [], summary: { steps: 1, variables: 0, lookups: 0 } });
    const archived = setup([row()], ['gastos']);
    expect(await archived.service.preflight('gastos', 'A')).toMatchObject({ ready: false });
    await expect(archived.service.publish('gastos', 1, 'A')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza tablas ausentes antes de publicación', async () => {
    const lookupFlow: Flow = { ...flow, steps: [{ ...flow.steps[0], who: { type: 'lookup', prompt: 'Responsable', query: { table: 'responsables', match: [{ column: 'usuario', op: 'eq', source: { var: 'solicitante' } }] }, person: { signerId: 'usuario' } } }] };
    const { service, prisma } = setup([row({ flow: lookupFlow })]);
    const check = await service.preflight('gastos', 'A');
    expect(check.errors.join()).toContain('no existe o no está activa');
    expect(prisma.lookupTable.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'A', key: { in: ['responsables'] }, active: true } }));
  });

  it('recorrido delega al resolver del producto con identidadJWT y sin crear solicitudes', async () => {
    const { service, resolver, prisma } = setup();
    const result = await service.previewFlow('gastos', 'A', 'actor-real', { values: { solicitante: 'spoof', monto: 100 } });
    expect(resolver.resolve).toHaveBeenCalledWith(flow, expect.objectContaining({ monto: 100 }), 'A', { solicitante: 'actor-real' });
    expect(result.steps[0]).toMatchObject({ active: true, participant: { signerId: 'actor-real' }, needsSelection: false });
    expect(result.values.solicitante).toBe('actor-real');
    expect(prisma.processDefinition.create).not.toHaveBeenCalled();
  });
});

describe('Paquetes portables e impacto', () => {
  it('exporta y reimporta configuración íntegra como borrador nuevo; corrupción falla', async () => {
    const { service, prisma } = setup();
    const pkg = await service.exportPackage('gastos', 'A');
    expect(pkg.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pkg.payload).not.toHaveProperty('tenantId');
    expect(await service.importPackage('B', pkg as any)).toMatchObject({ tenantId: 'B', name: 'Gastos', published: false, flow });
    await expect(service.importPackage('B', { ...pkg, payload: { ...pkg.payload, name: 'Alterado' } } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.processDefinition.create).toHaveBeenCalledTimes(1);
  });

  it('cuenta impacto por estado y versión de formato siempre acotado al tenant', async () => {
    const { service, prisma } = setup();
    expect(await service.impact('gastos', 'A')).toMatchObject({ workflows: { total: 7, active: 2 }, templates: { total: 3, byVersion: [{ version: 1, count: 3 }] }, versionAttribution: 'not-recorded' });
    expect(prisma.workflowRun.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'A', processKey: 'gastos' } }));
    expect(prisma.documentTemplate.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'A', flowKey: 'gastos' } }));
  });

  it('toda escritura y laboratorio exige admin', () => {
    for (const handler of ['catalog', 'versions', 'version', 'get', 'bpmn', 'dmn', 'archive', 'unarchive', 'restore', 'preflight', 'previewFlow', 'importPackage', 'exportPackage', 'impact'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, ProcessController.prototype[handler])).toEqual(['admin']);
    }
  });

  it('remitentes reciben solo publicaciones sin XML, reglas ni configuración de tablas', async () => {
    const secretFlow: Flow = { ...flow, steps: [{ ...flow.steps[0], who: { type: 'lookup', query: { table: 'privada', match: [] }, person: { signerId: 'usuario' }, prompt: 'Elegir persona' } }] };
    const process = { listPublished: vi.fn(async () => [row({ published: true, flow: secretFlow, dmnXml: 'privado', decisionRules: [{ secreto: true }] })]), list: vi.fn() };
    const controller = new ProcessController(process as any, {} as any);
    const result = await controller.list({}, { tenantId: 'A', roles: ['sender'] } as any);
    expect(result).toHaveLength(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('bpmnXml');
    expect(serialized).not.toContain('dmnXml');
    expect(serialized).not.toContain('decisionRules');
    expect(serialized).not.toContain('privada');
    expect(serialized).toContain('Elegir persona');
    expect(process.list).not.toHaveBeenCalled();
  });
});
