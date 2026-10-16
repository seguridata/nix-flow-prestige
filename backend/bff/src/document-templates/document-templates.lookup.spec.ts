/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { DocumentTemplatesService } from './document-templates.service';
import { FlowResolverService } from '../lookup-tables/flow-resolver.service';
import { makeLookupDb } from '../lookup-tables/lookup-tables.fixtures';
import { DEFAULT_SIGNATURE_POLICY } from '../signing/signature-policy';
import type { Flow, LookupQuery } from '../flow/flow.types';
import type { TemplateActor } from './template.types';

const columns = [
  { key: 'etapa', label: 'Etapa', type: 'select', options: ['area', 'tipoGasto'] },
  { key: 'area', label: 'Área', type: 'text' },
  { key: 'tipoGasto', label: 'Tipo', type: 'text' },
  { key: 'concepto', label: 'Concepto', type: 'text' },
  { key: 'montoMin', label: 'Desde', type: 'number' },
  { key: 'montoMax', label: 'Hasta', type: 'number' },
  { key: 'signerId', label: 'Responsable', type: 'text' },
  { key: 'nombre', label: 'Nombre', type: 'text' },
  { key: 'correo', label: 'Correo', type: 'text' },
];

const queryOf = (etapa: 'area' | 'tipoGasto'): LookupQuery => ({
  table: 'responsables-gasto',
  match: [
    { column: 'etapa', op: 'eq', source: { value: etapa }, emptyMatchesAny: false },
    ...(etapa === 'area'
      ? [{ column: 'area', op: 'eq' as const, source: { var: 'area' }, emptyMatchesAny: true }]
      : [
          { column: 'tipoGasto', op: 'eq' as const, source: { var: 'tipoGasto' }, emptyMatchesAny: true },
          { column: 'concepto', op: 'eq' as const, source: { var: 'concepto' }, emptyMatchesAny: true },
          { column: 'montoMin', op: 'gte' as const, source: { var: 'monto' }, emptyMatchesAny: true },
          { column: 'montoMax', op: 'lte' as const, source: { var: 'monto' }, emptyMatchesAny: true },
        ]),
  ],
});
const person = { signerId: 'signerId', name: 'nombre', email: 'correo' };

const flow: Flow = {
  order: 'SECUENCIAL',
  slaHours: 48,
  variables: [
    { key: 'area', label: 'Área', type: 'select', required: true, options: ['QA', 'RH'] },
    { key: 'tipoGasto', label: 'Tipo', type: 'select', required: true, options: ['Marketing', 'Viaje'] },
    { key: 'concepto', label: 'Concepto', type: 'select', required: true, options: ['Marketing: Publicidad', 'Gastos de Viaje'] },
    { key: 'monto', label: 'Monto', type: 'number', required: true },
  ],
  steps: [
    { id: 'sol', label: 'Solicitante', who: { type: 'initiator' }, role: 'FIRMANTE' },
    { id: 'aut_area', label: 'Autorización por área', who: { type: 'lookup', query: queryOf('area'), person, prompt: '¿Quién autoriza el área?' }, role: 'FIRMANTE' },
    { id: 'aut_tipo', label: 'Autorización por tipo', who: { type: 'lookup', query: queryOf('tipoGasto'), person, prompt: '¿Quién autoriza el gasto?' }, role: 'FIRMANTE' },
    {
      id: 'solo_viaje',
      label: 'Solo viaje',
      who: { type: 'lookup', query: queryOf('tipoGasto'), person, prompt: '¿Quién?' },
      role: 'REVISOR',
      when: [{ variable: 'tipoGasto', op: '==', value: 'Viaje' }],
    },
    { id: 'ask', label: 'Preguntar', who: { type: 'ask', prompt: '¿Quién?' }, role: 'REVISOR' },
  ],
};

const actor: TemplateActor = { tenantId: 'acme', actorId: 'maria', name: 'María', email: 'm@x.mx', isAdmin: false };
const admin: TemplateActor = { ...actor, actorId: 'admin', isAdmin: true };

const tableA = { id: 'tA', tenantId: 'acme', key: 'responsables-gasto', name: 'Responsables', columns, revision: 4, createdBy: 'x' };
const tableB = { id: 'tB', tenantId: 'otro', key: 'responsables-gasto', name: 'Responsables', columns, revision: 8, createdBy: 'x' };
const row = (tableId: string, position: number, values: Record<string, unknown>) => ({
  id: `${tableId}-${position}`,
  tenantId: tableId === 'tA' ? 'acme' : 'otro',
  tableId,
  position,
  values,
});

// «De lo específico a lo general»: así la migración dejó la matriz.
const rows = [
  row('tA', 0, { etapa: 'area', area: 'QA', signerId: 'jefe-qa', nombre: 'Jefe QA', correo: 'qa@x.mx' }),
  row('tA', 1, { etapa: 'tipoGasto', tipoGasto: 'Marketing', concepto: 'Marketing: Publicidad', signerId: 'dir-mkt', nombre: 'Dir Mkt' }),
  row('tA', 2, { etapa: 'tipoGasto', tipoGasto: 'Viaje', concepto: 'Gastos de Viaje', montoMax: 10_000, signerId: 'viaje-chico' }),
  row('tA', 3, { etapa: 'tipoGasto', tipoGasto: 'Viaje', concepto: 'Gastos de Viaje', montoMin: 10_000.01, signerId: 'viaje-grande' }),
  row('tB', 0, { etapa: 'area', area: 'QA', signerId: 'de-otro-tenant' }),
];

async function setup(opts: { tables?: any[]; rows?: any[]; templateFlow?: Flow } = {}) {
  const pdf = Buffer.from(await (async () => { const d = await PDFDocument.create(); d.addPage([612, 792]); return d.save(); })());
  const tpl = { id: 't1', tenantId: 'acme', name: 'Adq', published: true, objectKey: 'templates/acme/x.pdf', enc: {}, pageCount: 1, fields: [], signatureBoxes: [], flow: opts.templateFlow ?? flow, methods: ['ACCEPT'], kycPolicy: 'NONE', requirePasskey: false, flowKey: null, flowVersion: null, description: null, category: null };
  const db = makeLookupDb({ tables: opts.tables ?? [tableA, tableB], rows: opts.rows ?? rows });
  const prisma = {
    ...db,
    documentTemplate: { findFirst: vi.fn(async ({ where }: any) => (where.tenantId === 'acme' ? tpl : null)), update: vi.fn(async () => ({})) },
    case: { create: vi.fn(async () => ({ id: 'c1' })) },
  };
  const audit = { append: vi.fn(async () => ({})) };
  const resolver = new FlowResolverService(prisma as any, audit as any);
  const requests = { create: vi.fn(async (b: any) => ({ id: 'sr1', signers: b.signers.map((s: any) => ({ ...s })) })) };
  const documents = { create: vi.fn(async () => ({ id: 'd1' })) };
  const svc = new DocumentTemplatesService(
    prisma as any,
    { getObject: vi.fn(async () => pdf) } as any,
    documents as any,
    requests as any,
    { createMany: vi.fn(async () => []) } as any,
    { assertOwned: vi.fn() } as any,
    resolver,
    undefined as any,
    { resolve: vi.fn(async () => ({ ...DEFAULT_SIGNATURE_POLICY })) } as any,
  );
  return { svc, requests, documents, audit, prisma, db };
}

const values = { area: 'QA', tipoGasto: 'Marketing', concepto: 'Marketing: Publicidad', monto: 500 };
const byId = (steps: any[]) => Object.fromEntries(steps.map((s) => [s.stepId, s]));

describe('previewFlow con pasos lookup', () => {
  it('resuelve con área, tipoGasto, concepto y monto, y marca lo que no se resolvió', async () => {
    const { svc } = await setup();
    const out = await svc.previewFlow('t1', values, actor);
    const by = byId(out.steps);
    expect(by.aut_area.resolved).toEqual({ signerId: 'jefe-qa', name: 'Jefe QA', email: 'qa@x.mx' });
    expect(by.aut_area.unresolved).toBeUndefined();
    expect(by.aut_tipo.resolved.signerId).toBe('dir-mkt');
    // inactivo (condición no se cumple): ni resolved ni unresolved
    expect(by.solo_viaje.active).toBe(false);
    expect(by.solo_viaje.resolved).toBeUndefined();
    expect(by.solo_viaje.unresolved).toBeUndefined();
    // initiator / ask no cambian
    expect(by.sol).toEqual({ stepId: 'sol', label: 'Solicitante', role: 'FIRMANTE', who: { type: 'initiator' }, active: true });
    expect(by.ask.resolved).toBeUndefined();
    expect(by.ask.unresolved).toBeUndefined();
  });

  it('el usuario no recibe celdas de la tabla: solo la persona resuelta', async () => {
    const { svc } = await setup();
    const out = await svc.previewFlow('t1', values, actor);
    expect(Object.keys(byId(out.steps).aut_area.resolved).sort()).toEqual(['email', 'name', 'signerId']);
    expect(JSON.stringify(out)).not.toContain('montoMin');
  });

  it('sin coincidencia → unresolved (y el tenant no ve filas ajenas)', async () => {
    const { svc } = await setup();
    const out = await svc.previewFlow('t1', { ...values, area: 'RH' }, actor);
    const area = byId(out.steps).aut_area;
    expect(area.unresolved).toBe(true);
    expect(area.resolved).toBeUndefined();
  });

  it('el monto elige el responsable de viaje', async () => {
    const { svc } = await setup();
    const v = { area: 'QA', tipoGasto: 'Viaje', concepto: 'Gastos de Viaje' };
    const pick = async (monto: number) => byId((await svc.previewFlow('t1', { ...v, monto }, actor)).steps).solo_viaje.resolved?.signerId;
    expect(await pick(9_000)).toBe('viaje-chico');
    expect(await pick(10_000)).toBe('viaje-chico');
    expect(await pick(50_000)).toBe('viaje-grande');
  });

  it('una sola carga de tablas por vista previa, acotada al tenant', async () => {
    const { svc, db } = await setup();
    await svc.previewFlow('t1', { area: 'QA', tipoGasto: 'Viaje', concepto: 'Gastos de Viaje', monto: 1 }, actor);
    expect(db.lookupTable.findMany.mock.calls).toHaveLength(1);
    expect(db.lookupTable.findMany.mock.calls[0]![0].where).toMatchObject({ tenantId: 'acme', active: true });
  });

  it('con los valores a medio capturar no truena: lo que falta queda «por asignar» (awaiting), no «sin resolver»', async () => {
    const { svc } = await setup();
    const out = await svc.previewFlow('t1', {}, actor);
    const by = byId(out.steps);
    expect(by.aut_area.awaiting).toEqual([{ key: 'area', label: 'Área' }]);
    expect(by.aut_area.unresolved).toBeUndefined();
    expect(by.aut_area.resolved).toBeUndefined();
    expect(by.aut_tipo.awaiting.map((w: any) => w.key)).toEqual(['tipoGasto', 'concepto', 'monto']);
    expect(by.aut_tipo.awaiting.map((w: any) => w.label)).toEqual(['Tipo', 'Concepto', 'Monto']);
    expect(by.ask.awaiting).toBeUndefined();
    expect(by.sol.awaiting).toBeUndefined();
    expect(by.solo_viaje.awaiting).toBeUndefined(); // inactivo
  });

  it('awaiting y unresolved son excluyentes: con los datos completos y sin coincidencia solo hay unresolved', async () => {
    const { svc } = await setup();
    const partial = byId((await svc.previewFlow('t1', { area: 'QA' }, actor)).steps);
    expect(partial.aut_area.resolved?.signerId).toBe('jefe-qa');
    expect(partial.aut_area.awaiting).toBeUndefined();
    expect(partial.aut_tipo.awaiting).toBeDefined();
    expect(partial.aut_tipo.unresolved).toBeUndefined();
    const full = byId((await svc.previewFlow('t1', { ...values, area: 'RH' }, actor)).steps);
    expect(full.aut_area.unresolved).toBe(true);
    expect(full.aut_area.awaiting).toBeUndefined();
  });

  it('una variable no obligatoria vacía cuenta como entrada completa: se consulta (puede no coincidir), no se espera', async () => {
    const f: Flow = { ...flow, variables: flow.variables.map((v) => (v.key === 'concepto' ? { ...v, required: false } : v)) };
    const { svc } = await setup({ templateFlow: f });
    const out = byId((await svc.previewFlow('t1', { area: 'QA', tipoGasto: 'Marketing', monto: 500 }, actor)).steps);
    expect(out.aut_tipo.awaiting).toBeUndefined();
    // entrada completa (aunque vacía): la consulta corrió y la fila exige un concepto → sin coincidencia, no «por asignar»
    expect(out.aut_tipo.unresolved).toBe(true);
  });

  it('administrador y usuario reciben lo mismo en awaiting, y nunca la consulta (tabla, columnas)', async () => {
    const { svc } = await setup();
    const u = await svc.previewFlow('t1', {}, actor);
    const a = await svc.previewFlow('t1', {}, admin);
    expect(a.steps).toEqual(u.steps);
    const json = JSON.stringify(u);
    for (const secret of ['responsables-gasto', 'montoMin', 'montoMax', 'signerId', 'etapa']) expect(json).not.toContain(secret);
    expect(byId(u.steps).aut_area.who).toEqual({ type: 'lookup', prompt: '¿Quién autoriza el área?' });
  });

  it('las variables derivadas deciden qué pasos aplican en la vista previa', async () => {
    const f: Flow = {
      ...flow,
      derived: [{ key: 'nivel', label: 'Nivel', type: 'number', column: 'montoMin', query: { table: 'responsables-gasto', match: [{ column: 'etapa', op: 'eq', source: { value: 'tipoGasto' } }, { column: 'tipoGasto', op: 'eq', source: { var: 'tipoGasto' } }, { column: 'montoMin', op: 'isNotEmpty' }] } }],
      steps: [flow.steps[0]!, { id: 'extra', label: 'Extra', who: { type: 'ask', prompt: '¿Quién?' }, role: 'REVISOR', when: [{ variable: 'nivel', op: '>', value: 100 }] }],
    };
    const { svc } = await setup({ templateFlow: f });
    const v = { area: 'QA', concepto: 'Gastos de Viaje', monto: 1 };
    expect(byId((await svc.previewFlow('t1', { ...v, tipoGasto: 'Viaje' }, actor)).steps).extra.active).toBe(true);
    expect(byId((await svc.previewFlow('t1', { ...v, tipoGasto: 'Marketing' }, actor)).steps).extra.active).toBe(false);
  });
});

describe('instantiate con pasos lookup', () => {
  it('los pasos resueltos entran como firmantes sin preguntar', async () => {
    const { svc, requests } = await setup();
    const out = await svc.instantiate('t1', { values, askedSigners: { ask: { signerId: 'carlos' } } }, actor);
    expect(requests.create.mock.calls[0]![0].signers.map((s: any) => s.signerId)).toEqual(['maria', 'jefe-qa', 'dir-mkt', 'carlos']);
    expect(requests.create.mock.calls[0]![0].signers[1]).toMatchObject({ name: 'Jefe QA', email: 'qa@x.mx' });
    expect((out.steps.find((s) => s.stepId === 'aut_tipo') as any).resolved.signerId).toBe('dir-mkt');
  });

  it('sin coincidencia se comporta como «preguntar»: usa askedSigners[stepId]', async () => {
    const { svc, requests } = await setup();
    const out = await svc.instantiate('t1', { values: { ...values, area: 'RH' }, askedSigners: { aut_area: { signerId: 'manual' }, ask: { signerId: 'carlos' } } }, actor);
    expect(requests.create.mock.calls[0]![0].signers.map((s: any) => s.signerId)).toEqual(['maria', 'manual', 'dir-mkt', 'carlos']);
    expect((out.steps.find((s) => s.stepId === 'aut_area') as any).unresolved).toBe(true);
  });

  it('instantiate usa los mismos nombres: con los datos completos no hay awaiting; si faltan requeridos → 400 sin crear nada', async () => {
    const { svc, requests } = await setup();
    const out = await svc.instantiate('t1', { values, askedSigners: { ask: { signerId: 'c' } } }, actor);
    expect(out.steps.every((s: any) => s.awaiting === undefined)).toBe(true);
    expect(requests.create).toHaveBeenCalledTimes(1);
    const err: any = await svc.instantiate('t1', { values: { area: 'QA' }, askedSigners: { ask: { signerId: 'c' } } }, actor).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(requests.create).toHaveBeenCalledTimes(1);
  });

  it('sin coincidencia y sin respuesta manual → 400, sin crear nada ni auditar', async () => {
    const { svc, requests, documents, prisma, audit } = await setup();
    const err: any = await svc.instantiate('t1', { values: { ...values, area: 'RH' }, askedSigners: { ask: { signerId: 'c' } } }, actor).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('Autorización por área');
    expect(requests.create).not.toHaveBeenCalled();
    expect(documents.create).not.toHaveBeenCalled();
    expect(prisma.case.create).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('el tenant A no usa filas del tenant B', async () => {
    const { svc, requests } = await setup({ rows: rows.filter((r) => r.tenantId === 'otro') });
    await svc.instantiate('t1', { values, askedSigners: { aut_area: { signerId: 'm1' }, aut_tipo: { signerId: 'm2' }, ask: { signerId: 'm3' } } }, actor);
    expect(requests.create.mock.calls[0]![0].signers.map((s: any) => s.signerId)).toEqual(['maria', 'm1', 'm2', 'm3']);
  });

  it('una derivada con onMiss «fail» sin coincidencia → 400 y no se crea nada', async () => {
    const f: Flow = {
      ...flow,
      derived: [{ key: 'nivel', label: 'Nivel de aprobación', type: 'number', column: 'montoMin', onMiss: 'fail', query: { table: 'responsables-gasto', match: [{ column: 'etapa', op: 'eq', source: { value: 'tipoGasto' } }, { column: 'concepto', op: 'eq', source: { var: 'concepto' }, emptyMatchesAny: false }, { column: 'montoMin', op: 'isNotEmpty' }] } }],
    };
    const { svc, requests, documents } = await setup({ templateFlow: f });
    const err: any = await svc.instantiate('t1', { values: { ...values, concepto: 'Gastos de Viaje', tipoGasto: 'Viaje', monto: 1 }, askedSigners: { ask: { signerId: 'c' } } }, actor).catch((e) => e);
    // «Gastos de Viaje» sí tiene fila con montoMin → no falla; con un concepto sin filas con montoMin, sí
    expect(err).not.toBeInstanceOf(BadRequestException);
    const miss: any = await svc.instantiate('t1', { values: { ...values, concepto: 'Marketing: Publicidad' }, askedSigners: { ask: { signerId: 'c' } } }, actor).catch((e) => e);
    expect(miss).toBeInstanceOf(BadRequestException);
    expect(miss.message).toContain('Nivel de aprobación');
    expect(requests.create).toHaveBeenCalledTimes(1); // solo la primera
    expect(documents.create).toHaveBeenCalledTimes(1);
  });

  describe('auditoría LOOKUP_RESOLVED', () => {
    it('registra tabla, revisión y fila por paso, atada a la solicitud, sin valores personales', async () => {
      const { svc, audit } = await setup();
      await svc.instantiate('t1', { values, askedSigners: { ask: { signerId: 'carlos' } } }, actor);
      expect(audit.append).toHaveBeenCalledTimes(1);
      const ev = (audit.append.mock.calls[0] as any[])[0];
      expect(ev).toMatchObject({ tenantId: 'acme', actorId: 'maria', action: 'LOOKUP_RESOLVED', signatureRequestId: 'sr1', documentId: 'd1' });
      expect(ev.payload).toMatchObject({ tenantId: 'acme', actorId: 'maria', templateId: 't1', requestId: 'sr1' });
      expect(ev.payload.steps).toEqual([
        { stepId: 'aut_area', table: 'responsables-gasto', revision: 4, rowId: 'tA-0' },
        { stepId: 'aut_tipo', table: 'responsables-gasto', revision: 4, rowId: 'tA-1' },
      ]);
      const json = JSON.stringify(ev);
      for (const pii of ['jefe-qa', 'Jefe QA', 'qa@x.mx', 'dir-mkt', 'Dir Mkt', 'María', 'm@x.mx', 'carlos']) expect(json).not.toContain(pii);
    });

    it('un paso que cayó a «preguntar» queda con rowId null; cambiar la tabla después no cambia lo registrado', async () => {
      const { svc, audit, db } = await setup();
      await svc.instantiate('t1', { values: { ...values, area: 'RH' }, askedSigners: { aut_area: { signerId: 'manual' }, ask: { signerId: 'c' } } }, actor);
      expect(((audit.append.mock.calls[0] as any[])[0].payload.steps as any[])[0]).toEqual({ stepId: 'aut_area', table: 'responsables-gasto', revision: 4, rowId: null });
      db.state.tables[0].revision = 99; // el evento ya escrito no cambia: lo congelado es lo que se vio
      expect(((audit.append.mock.calls[0] as any[])[0].payload.steps as any[])[1].revision).toBe(4);
    });

    it('un formato sin consultas no genera el evento', async () => {
      const simple: Flow = { ...flow, steps: [flow.steps[0]!, flow.steps[4]!] };
      const { svc, audit } = await setup({ templateFlow: simple });
      await svc.instantiate('t1', { values, askedSigners: { ask: { signerId: 'c' } } }, actor);
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('si la cadena de auditoría falla, la solicitud ya creada se conserva', async () => {
      const { svc, audit, requests } = await setup();
      audit.append.mockRejectedValueOnce(new Error('cadena caída'));
      const out = await svc.instantiate('t1', { values, askedSigners: { ask: { signerId: 'c' } } }, actor);
      expect(out.signatureRequestId).toBe('sr1');
      expect(requests.create).toHaveBeenCalledTimes(1);
    });
  });
});

describe('quien llena el formato no ve la configuración de las consultas', () => {
  it('get: el usuario recibe el flujo sin tabla ni columnas; el admin lo recibe completo', async () => {
    const { svc } = await setup();
    const user: any = await svc.get('t1', actor);
    const adm: any = await svc.get('t1', admin);
    const userJson = JSON.stringify(user.flow);
    for (const secret of ['responsables-gasto', 'montoMin', 'signerId']) expect(userJson).not.toContain(secret);
    expect(user.flow.steps[1].who).toEqual({ type: 'lookup', prompt: '¿Quién autoriza el área?' });
    expect(user.flow.variables).toEqual(flow.variables);
    expect(adm.flow.steps[1].who.query.table).toBe('responsables-gasto');
    expect(user).not.toHaveProperty('objectKey');
  });

  it('preview e instantiate devuelven `who` sin la consulta', async () => {
    const { svc } = await setup();
    const pre = await svc.previewFlow('t1', values, actor);
    expect(byId(pre.steps).aut_area.who).toEqual({ type: 'lookup', prompt: '¿Quién autoriza el área?' });
    const out = await svc.instantiate('t1', { values, askedSigners: { ask: { signerId: 'c' } } }, actor);
    expect((out.steps.find((s) => s.stepId === 'aut_area') as any).who).toEqual({ type: 'lookup', prompt: '¿Quién autoriza el área?' });
    expect(JSON.stringify(out)).not.toContain('responsables-gasto');
  });
});

describe('editar un formato valida las tablas citadas', () => {
  it('con un flujo que cita una tabla que no existe → 400 y no escribe', async () => {
    const { svc, prisma } = await setup({ tables: [tableB], rows: [] });
    const err: any = await svc.update('t1', { flow }, admin).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toContain('no existe o no está activa');
    expect(prisma.documentTemplate.update).not.toHaveBeenCalled();
  });

  it('con una tabla activa y columnas que cuadran → se guarda', async () => {
    const { svc, prisma } = await setup();
    await svc.update('t1', { flow }, admin);
    expect(prisma.documentTemplate.update).toHaveBeenCalledTimes(1);
  });

  it('con una tabla inactiva → 400', async () => {
    const { svc } = await setup({ tables: [{ ...tableA, active: false }] });
    await expect(svc.update('t1', { flow }, admin)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renombrar (sin tocar el flujo) no revalida las tablas: no falla porque una tabla se desactivó después', async () => {
    const { svc } = await setup({ tables: [{ ...tableA, active: false }] });
    await expect(svc.update('t1', { description: 'nueva descripción' }, admin)).resolves.toBeTruthy();
  });
});
