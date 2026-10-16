/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ADQUISICIONES_FLOW, AREAS, CONCEPTOS, PROVEEDORES_ESTRATEGICOS_FLOW, RENOVACION_LICENCIAS_FLOW, ROL_EJECUTIVO_AYT, TABLA_RESPONSABLES, TABLA_ROLES, TIPOS_GASTO } from './adquisiciones.flows';
import { flowQueries, resolveFlow, validateFlow } from '../flow/flow';
import { runLookup, type LookupColumn } from '../lookup-tables/lookup-engine';
import { MAX_STEPS } from '../flow/flow.types';
import { PLATFORM_TENANT, ProcessService } from './process.service';
import { FlowResolverService } from '../lookup-tables/flow-resolver.service';
import { makeLookupDb } from '../lookup-tables/lookup-tables.fixtures';

const activos = (tipoGasto: string) =>
  resolveFlow(ADQUISICIONES_FLOW, { tipoGasto })
    .filter((r) => r.active)
    .map((r) => r.step.id);

describe('flujos por defecto de Adquisiciones', () => {
  it.each([
    ['Adquisiciones', ADQUISICIONES_FLOW],
    ['Renovación de licenciamiento', RENOVACION_LICENCIAS_FLOW],
    ['Proveedores estratégicos', PROVEEDORES_ESTRATEGICOS_FLOW],
  ])('%s pasa validateFlow', (_n, flow) => {
    expect(validateFlow(flow)).toEqual([]);
  });

  it('Adquisiciones no pasa del máximo de pasos y tiene ids únicos', () => {
    expect(ADQUISICIONES_FLOW.steps.length).toBeLessThanOrEqual(MAX_STEPS);
    const ids = ADQUISICIONES_FLOW.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declara área (11), tipo de gasto, concepto (68) y monto, todos requeridos', () => {
    const v = Object.fromEntries(ADQUISICIONES_FLOW.variables.map((x) => [x.key, x]));
    expect(v.area).toMatchObject({ type: 'select', required: true });
    expect(v.area!.options).toEqual([...AREAS]);
    expect(AREAS).toHaveLength(11);
    expect(v.tipoGasto).toMatchObject({ type: 'select', required: true });
    expect(v.concepto).toMatchObject({ type: 'select', required: true });
    expect(v.concepto!.options).toHaveLength(68);
    expect(new Set(CONCEPTOS).size).toBe(CONCEPTOS.length);
    expect(v.monto).toMatchObject({ type: 'number', required: true });
  });

  it('las autorizaciones salen de la tabla responsables-gasto: área, tipo de gasto y, para bienes, factura y pago', () => {
    const who = (id: string) => ADQUISICIONES_FLOW.steps.find((s) => s.id === id)!.who;
    const stage = (id: string) => {
      const w = who(id);
      if (w.type !== 'lookup') throw new Error(`${id} no es lookup`);
      return w;
    };
    for (const id of ['AUT_AREA', 'AUT_TIPO', 'T26', 'T27']) {
      expect(stage(id).query.table).toBe(TABLA_RESPONSABLES);
      expect(stage(id).person).toEqual({ signerId: 'signerId', name: 'nombre', email: 'correo' });
      expect(stage(id).prompt.length).toBeGreaterThan(0);
    }
    expect(stage('AUT_AREA').query.match).toEqual([
      { column: 'etapa', op: 'eq', source: { value: 'area' }, emptyMatchesAny: false },
      { column: 'area', op: 'eq', source: { var: 'area' }, emptyMatchesAny: true },
    ]);
    const tipo = stage('AUT_TIPO').query.match;
    expect(tipo.map((c) => [c.column, c.op, JSON.stringify(c.source)])).toEqual([
      ['etapa', 'eq', '{"value":"tipoGasto"}'],
      ['tipoGasto', 'eq', '{"var":"tipoGasto"}'],
      ['concepto', 'eq', '{"var":"concepto"}'],
      ['montoMin', 'gte', '{"var":"monto"}'],
      ['montoMax', 'lte', '{"var":"monto"}'],
    ]);
    expect(stage('T26').query).toEqual(stage('AUT_TIPO').query);
    expect(stage('T27').query).toEqual(stage('AUT_TIPO').query);
    expect(who('T01')).toEqual({ type: 'initiator' });
    expect(ADQUISICIONES_FLOW.steps.find((s) => s.id === 'T01b')).toBeUndefined();
    expect(ADQUISICIONES_FLOW.steps.find((s) => s.id === 'T25')).toBeUndefined(); // fusionado en T22
    expect(JSON.stringify(ADQUISICIONES_FLOW)).not.toContain('"matrix"');
  });

  it('las consultas citan solo variables declaradas y no hay derivadas', () => {
    const declared = new Set(ADQUISICIONES_FLOW.variables.map((v) => v.key));
    for (const { query } of flowQueries(ADQUISICIONES_FLOW)) {
      for (const c of query.match) if (c.source && 'var' in c.source) expect(declared.has(c.source.var)).toBe(true);
    }
    expect(ADQUISICIONES_FLOW.derived).toBeUndefined();
  });

  describe('participantes: solicitante, ejecutivo de A&T y matriz', () => {
    const who = (id: string) => ADQUISICIONES_FLOW.steps.find((s) => s.id === id)!.who;
    const SOLICITANTE_IDS = ['T01', 'T14', 'T10', 'T13', 'T22'];
    const EJECUTIVO_IDS = ['T02', 'T04', 'T05', 'T07', 'T09', 'T11', 'T16', 'T18', 'T19', 'T30', 'T17'];
    const MATRIZ_IDS = ['AUT_AREA', 'AUT_TIPO', 'T26', 'T27'];

    it('los pasos del solicitante son «initiator» (ya no preguntan quién es)', () => {
      for (const id of SOLICITANTE_IDS) expect(who(id), id).toEqual({ type: 'initiator' });
    });

    it('los pasos del Ejecutivo de Administración y Tesorería consultan roles-adquisiciones con la pregunta de respaldo', () => {
      for (const id of EJECUTIVO_IDS) {
        const w = who(id);
        if (w.type !== 'lookup') throw new Error(`${id} no es lookup`);
        expect(w.query).toEqual({
          table: TABLA_ROLES,
          match: [{ column: 'rol', op: 'eq', source: { value: ROL_EJECUTIVO_AYT }, emptyMatchesAny: false }],
        });
        expect(w.person).toEqual({ signerId: 'signerId', name: 'nombre', email: 'correo' });
        expect(w.prompt).toBe('¿Quién es el ejecutivo de Administración y Tesorería?');
      }
      expect(ROL_EJECUTIVO_AYT).toBe('Ejecutivo de Administración y Tesorería');
    });

    it('todos los pasos quedan cubiertos: iniciador, ejecutivo o matriz; ya no queda ningún «ask» en Adquisiciones', () => {
      const all = [...SOLICITANTE_IDS, ...EJECUTIVO_IDS, ...MATRIZ_IDS].sort();
      expect(ADQUISICIONES_FLOW.steps.map((s) => s.id).sort()).toEqual(all);
      expect(ADQUISICIONES_FLOW.steps.some((s) => s.who.type === 'ask')).toBe(false);
      expect(ADQUISICIONES_FLOW.steps.length).toBeLessThanOrEqual(MAX_STEPS);
    });

    const rolesColumns = [
      { key: 'rol', label: 'Rol', type: 'text' },
      { key: 'signerId', label: 'Usuario', type: 'text' },
      { key: 'nombre', label: 'Nombre', type: 'text' },
      { key: 'correo', label: 'Correo', type: 'text' },
    ];
    const matrizColumns = [
      { key: 'etapa', label: 'Etapa', type: 'select', options: ['area', 'tipoGasto'] },
      { key: 'area', label: 'Área', type: 'text' },
      { key: 'tipoGasto', label: 'Tipo', type: 'text' },
      { key: 'concepto', label: 'Concepto', type: 'text' },
      { key: 'montoMin', label: 'Desde', type: 'number' },
      { key: 'montoMax', label: 'Hasta', type: 'number' },
      { key: 'signerId', label: 'Responsable', type: 'text' },
    ];
    /** `matriz` y `roles` son las filas de cada tabla; `withRoles: false` = el tenant no tiene la tabla de roles. */
    const resolver = (matriz: Array<Record<string, unknown>>, roles: Array<Record<string, unknown>>, withRoles = true) => {
      const db = makeLookupDb({
        tables: [
          { id: 'tM', tenantId: 'acme', key: TABLA_RESPONSABLES, revision: 2, columns: matrizColumns, createdBy: 'x' },
          ...(withRoles ? [{ id: 'tR', tenantId: 'acme', key: TABLA_ROLES, revision: 1, columns: rolesColumns, createdBy: 'x' }] : []),
        ],
        rows: [
          ...matriz.map((values, i) => ({ id: `m${i}`, tenantId: 'acme', tableId: 'tM', position: i, values })),
          ...roles.map((values, i) => ({ id: `r${i}`, tenantId: 'acme', tableId: 'tR', position: i, values })),
        ],
      });
      return new FlowResolverService(db as any, { append: vi.fn(async () => ({})) } as any);
    };
    const valores = { area: 'QA', tipoGasto: 'Marketing', concepto: 'Marketing: Publicidad', monto: 500 };
    const matriz = [
      { etapa: 'area', area: 'QA', signerId: 'jefe-qa' },
      { etapa: 'tipoGasto', tipoGasto: 'Marketing', signerId: 'mkt' },
    ];

    it('con la fila del rol, cada paso del ejecutivo sale de roles-adquisiciones; el solicitante no se consulta', async () => {
      const svc = resolver(matriz, [{ rol: ROL_EJECUTIVO_AYT, signerId: 'javazquez', nombre: 'Jesús Vázquez', correo: 'javazquez@seguridata.com' }]);
      const r = await svc.resolve(ADQUISICIONES_FLOW, valores, 'acme');
      expect(r.picks.get('T02')).toEqual({ signerId: 'javazquez', name: 'Jesús Vázquez', email: 'javazquez@seguridata.com' });
      expect(r.picks.get('AUT_AREA')?.signerId).toBe('jefe-qa');
      expect(r.picks.get('AUT_TIPO')?.signerId).toBe('mkt');
      expect(r.picks.has('T01')).toBe(false);
      expect(r.picks.has('T14')).toBe(false); // el solicitante es el iniciador: no hay consulta
    });

    it('sin la tabla roles-adquisiciones en el tenant los pasos caen a «preguntar» sin error; la matriz sigue resolviendo', async () => {
      const r = await resolver(matriz, [], false).resolve(ADQUISICIONES_FLOW, valores, 'acme');
      for (const id of ['T02', 'T04', 'T05', 'T16', 'T17']) expect(r.picks.get(id), id).toBeNull();
      expect(r.steps.find((s) => s.stepId === 'T02')).toEqual({ stepId: 'T02', table: TABLA_ROLES, revision: null, rowId: null });
      expect(r.picks.get('AUT_AREA')?.signerId).toBe('jefe-qa');
    });

    it('sin ninguna de las dos tablas todos los pasos consultados preguntan y no falla', async () => {
      const svc = new FlowResolverService(makeLookupDb({}) as any, { append: vi.fn(async () => ({})) } as any);
      const r = await svc.resolve(ADQUISICIONES_FLOW, valores, 'otro');
      expect(r.picks.size).toBeGreaterThan(0);
      expect([...r.picks.values()].every((p) => p === null)).toBe(true);
    });

    it('la tabla existe pero la fila del rol no (o está sin usuario): pregunta', async () => {
      const sinFila = await resolver(matriz, [{ rol: 'Otro rol', signerId: 'x' }]).resolve(ADQUISICIONES_FLOW, valores, 'acme');
      expect(sinFila.picks.get('T02')).toBeNull();
      const sinUsuario = await resolver(matriz, [{ rol: ROL_EJECUTIVO_AYT }]).resolve(ADQUISICIONES_FLOW, valores, 'acme');
      expect(sinUsuario.picks.get('T02')).toBeNull();
    });
  });

  describe('con la tabla responsables-gasto tal como la dejó la migración', () => {
    // Columnas y filas (de lo específico a lo general) como las migró 20261018100000.
    const columns: LookupColumn[] = [
      { key: 'etapa', label: 'Etapa', type: 'select', options: ['area', 'tipoGasto'] },
      { key: 'area', label: 'Área', type: 'text' },
      { key: 'tipoGasto', label: 'Tipo', type: 'text' },
      { key: 'concepto', label: 'Concepto', type: 'text' },
      { key: 'montoMin', label: 'Desde', type: 'number' },
      { key: 'montoMax', label: 'Hasta', type: 'number' },
      { key: 'signerId', label: 'Responsable', type: 'text' },
    ];
    const rows = [
      { etapa: 'area', area: 'QA', signerId: 'jefe-qa' },
      { etapa: 'area', signerId: 'jefe-cualquier-area' },
      { etapa: 'tipoGasto', tipoGasto: 'Viaje', concepto: 'Gastos de Viaje', montoMax: 10000, signerId: 'viaje-chico' },
      { etapa: 'tipoGasto', tipoGasto: 'Viaje', concepto: 'Gastos de Viaje', montoMin: 10000.01, signerId: 'viaje-grande' },
      { etapa: 'tipoGasto', tipoGasto: 'Marketing', signerId: 'mkt' },
      { etapa: 'tipoGasto', signerId: 'general' },
    ].map((values, i) => ({ id: `r${i}`, position: i, active: true, values }));
    const table = { key: TABLA_RESPONSABLES, revision: 1, columns, rows };
    const pick = (id: string, v: Record<string, string | number>) => {
      const w = ADQUISICIONES_FLOW.steps.find((s) => s.id === id)!.who;
      if (w.type !== 'lookup') throw new Error('no es lookup');
      return runLookup(table, w.query, v).hit?.values.signerId;
    };

    it('área: la fila de su área y, si no hay, la de «cualquier área»', () => {
      expect(pick('AUT_AREA', { area: 'qa' })).toBe('jefe-qa');
      expect(pick('AUT_AREA', { area: 'Soporte' })).toBe('jefe-cualquier-area');
    });

    it('tipo de gasto: concepto y monto eligen la fila; lo no específico cae en la general', () => {
      const v = { tipoGasto: 'Viaje', concepto: 'Gastos de Viaje' };
      expect(pick('AUT_TIPO', { ...v, monto: 500 })).toBe('viaje-chico');
      expect(pick('AUT_TIPO', { ...v, monto: 10000 })).toBe('viaje-chico');
      expect(pick('AUT_TIPO', { ...v, monto: 10000.01 })).toBe('viaje-grande');
      expect(pick('AUT_TIPO', { tipoGasto: 'Marketing', concepto: 'Marketing: Publicidad', monto: 5 })).toBe('mkt');
      expect(pick('T26', { tipoGasto: 'Bienes y servicios', concepto: 'HDW', monto: 5 })).toBe('general');
    });

    it('la etapa nunca vale «cualquiera»: una fila sin etapa no autoriza a nadie', () => {
      const sinEtapa = { ...table, rows: [{ id: 'x', position: 0, active: true, values: { signerId: 'intruso' } }] };
      const w = ADQUISICIONES_FLOW.steps.find((s) => s.id === 'AUT_AREA')!.who;
      if (w.type !== 'lookup') throw new Error('no es lookup');
      expect(runLookup(sinEtapa, w.query, { area: 'QA' }).hit).toBeNull();
    });
  });

  const TRONCO = ['T01', 'AUT_AREA', 'AUT_TIPO', 'T02', 'T04', 'T05', 'T16'];

  it('Bienes y servicios: orden de compra, solicitud al proveedor y recepción hasta el pago', () => {
    expect(activos('Bienes y servicios')).toEqual([...TRONCO.slice(0, 6), 'T09', 'T16', 'T18', 'T22', 'T26', 'T27']);
  });

  it('Costo de venta directo: cotización Entrust, OC, aduana y recepción', () => {
    expect(activos('Costo de venta directo (Entrust)')).toEqual([...TRONCO.slice(0, 6), 'T07', 'T09', 'T16', 'T19', 'T22', 'T26', 'T27']);
  });

  it('Oficina, seguros y comunicación: reembolso/comprobantes y pago con tarjeta; sin recepción ni orden de compra', () => {
    expect(activos('Gastos de oficina, seguros y comunicación')).toEqual([...TRONCO.slice(0, 6), 'T14', 'T16', 'T30']);
  });

  it('Marketing: comprobantes y anticipo/saldo; sin orden de compra', () => {
    expect(activos('Marketing')).toEqual([...TRONCO.slice(0, 6), 'T14', 'T16', 'T17']);
  });

  it('Viaje: reserva, 3 agencias, conformidad y anticipo/saldo', () => {
    expect(activos('Viaje')).toEqual([...TRONCO.slice(0, 6), 'T10', 'T11', 'T13', 'T16', 'T17']);
  });

  it('cada tipo de gasto activa más pasos que solo el tronco y ninguno queda sin camino propio', () => {
    for (const t of TIPOS_GASTO) expect(activos(t).length).toBeGreaterThan(TRONCO.length);
  });
});

describe('ensureSeeds con flujo por defecto', () => {
  const mk = (existing: Record<string, any>) => {
    const create = vi.fn(async () => ({}));
    const findFirst = vi.fn(async ({ where }: any) => existing[where.key] ?? null);
    return { create, svc: new ProcessService({ processDefinition: { findFirst, create } } as any, {} as any) };
  };
  const created = (create: any, key: string) => create.mock.calls.map((c: any[]) => c[0].data).filter((d: any) => d.key === key);

  it('base vacía: crea las tres con su flujo, en la plataforma y en versión 1', async () => {
    const { svc, create } = mk({});
    await svc.ensureSeeds();
    for (const key of ['adquisiciones-gastos', 'renovacion-licenciamiento', 'proveedores-estrategicos']) {
      const [d] = created(create, key);
      expect(d.tenantId).toBe(PLATFORM_TENANT);
      expect(d.version).toBe(1);
      expect(validateFlow(d.flow)).toEqual([]);
    }
    // Las semillas anteriores no traen flujo.
    expect(created(create, 'contrato-dos-partes')[0].flow).toBeUndefined();
  });

  it('el flujo sembrado difiere del de la última versión: agrega una versión nueva (y no duplica si ya coincide)', async () => {
    const stale = { ...ADQUISICIONES_FLOW, steps: ADQUISICIONES_FLOW.steps.slice(0, 3) };
    const { svc, create } = mk({
      'adquisiciones-gastos': { key: 'adquisiciones-gastos', version: 4, flow: stale },
      'renovacion-licenciamiento': { key: 'renovacion-licenciamiento', version: 1, flow: JSON.parse(JSON.stringify(RENOVACION_LICENCIAS_FLOW)) },
      'proveedores-estrategicos': { key: 'proveedores-estrategicos', version: 1, flow: PROVEEDORES_ESTRATEGICOS_FLOW },
      'contrato-dos-partes': { key: 'contrato-dos-partes', version: 1, flow: null },
      'onboarding-identidad': { key: 'onboarding-identidad', version: 1, flow: null },
    });
    await svc.ensureSeeds();
    expect(create).toHaveBeenCalledTimes(1);
    const [d] = created(create, 'adquisiciones-gastos');
    expect(d.version).toBe(5);
    expect(d.tenantId).toBe(PLATFORM_TENANT);
    expect(d.flow).toEqual(ADQUISICIONES_FLOW);
  });

  it('un flujo sembrado con los participantes anteriores («preguntar») se reemplaza por una versión nueva con las consultas', async () => {
    const anterior = JSON.parse(JSON.stringify(ADQUISICIONES_FLOW));
    for (const s of anterior.steps) {
      if (s.who.type === 'lookup' && s.who.query.table === TABLA_ROLES) s.who = { type: 'ask', prompt: s.who.prompt };
      if (s.who.type === 'initiator' && s.id !== 'T01') s.who = { type: 'ask', prompt: '¿Quién es el solicitante o responsable de área?' };
    }
    expect(validateFlow(anterior)).toEqual([]);
    const { svc, create } = mk({
      'adquisiciones-gastos': { key: 'adquisiciones-gastos', version: 7, flow: anterior },
      'renovacion-licenciamiento': { key: 'renovacion-licenciamiento', version: 1, flow: RENOVACION_LICENCIAS_FLOW },
      'proveedores-estrategicos': { key: 'proveedores-estrategicos', version: 1, flow: PROVEEDORES_ESTRATEGICOS_FLOW },
      'contrato-dos-partes': { key: 'contrato-dos-partes', version: 1, flow: null },
      'onboarding-identidad': { key: 'onboarding-identidad', version: 1, flow: null },
    });
    await svc.ensureSeeds();
    expect(create).toHaveBeenCalledTimes(1);
    const [d] = created(create, 'adquisiciones-gastos');
    expect(d.version).toBe(8);
    expect(d.flow).toEqual(ADQUISICIONES_FLOW);
    expect(JSON.stringify(d.flow)).toContain(TABLA_ROLES);
  });

  it('compara JSON estable: el orden de las claves no cuenta', async () => {
    const reordered = JSON.parse(JSON.stringify({ steps: ADQUISICIONES_FLOW.steps, variables: ADQUISICIONES_FLOW.variables, slaHours: 72, order: 'SECUENCIAL' }));
    const { svc, create } = mk({
      'adquisiciones-gastos': { key: 'adquisiciones-gastos', version: 1, flow: reordered },
      'renovacion-licenciamiento': { key: 'renovacion-licenciamiento', version: 1, flow: RENOVACION_LICENCIAS_FLOW },
      'proveedores-estrategicos': { key: 'proveedores-estrategicos', version: 1, flow: PROVEEDORES_ESTRATEGICOS_FLOW },
      'contrato-dos-partes': { key: 'contrato-dos-partes', version: 1, flow: null },
      'onboarding-identidad': { key: 'onboarding-identidad', version: 1, flow: null },
    });
    await svc.ensureSeeds();
    expect(create).not.toHaveBeenCalled();
  });

  it('definición ya existente sin flujo: agrega la versión siguiente con el flujo', async () => {
    const { svc, create } = mk({
      'adquisiciones-gastos': { key: 'adquisiciones-gastos', version: 2, flow: null },
      'renovacion-licenciamiento': { key: 'renovacion-licenciamiento', version: 1, flow: null },
      'proveedores-estrategicos': { key: 'proveedores-estrategicos', version: 1, flow: null },
      'contrato-dos-partes': { key: 'contrato-dos-partes', version: 2, flow: null },
      'onboarding-identidad': { key: 'onboarding-identidad', version: 2, flow: null },
    });
    await svc.ensureSeeds();
    expect(created(create, 'adquisiciones-gastos')[0].version).toBe(3);
    expect(created(create, 'renovacion-licenciamiento')[0].version).toBe(2);
    expect(created(create, 'contrato-dos-partes')).toHaveLength(0);
  });

  it('idempotente: si la última versión ya trae flujo, no crea nada', async () => {
    const withFlow = (key: string, flow: unknown) => ({ [key]: { key, version: 3, flow } });
    const { svc, create } = mk({
      ...withFlow('adquisiciones-gastos', ADQUISICIONES_FLOW),
      ...withFlow('renovacion-licenciamiento', RENOVACION_LICENCIAS_FLOW),
      ...withFlow('proveedores-estrategicos', PROVEEDORES_ESTRATEGICOS_FLOW),
      'contrato-dos-partes': { key: 'contrato-dos-partes', version: 1, flow: null },
      'onboarding-identidad': { key: 'onboarding-identidad', version: 1, flow: null },
    });
    await svc.ensureSeeds();
    expect(create).not.toHaveBeenCalled();
  });
});
