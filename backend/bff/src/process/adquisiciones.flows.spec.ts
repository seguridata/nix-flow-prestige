/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ADQUISICIONES_FLOW, AREAS, CONCEPTOS, PROVEEDORES_ESTRATEGICOS_FLOW, RENOVACION_LICENCIAS_FLOW, TIPOS_GASTO } from './adquisiciones.flows';
import { resolveFlow, validateFlow } from '../flow/flow';
import { MAX_STEPS } from '../flow/flow.types';
import { PLATFORM_TENANT, ProcessService } from './process.service';

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

  it('las autorizaciones salen de la matriz: área, tipo de gasto y, para bienes, factura y pago', () => {
    const who = (id: string) => ADQUISICIONES_FLOW.steps.find((s) => s.id === id)!.who;
    expect(who('AUT_AREA')).toMatchObject({ type: 'matrix', stage: 'area' });
    expect(who('AUT_TIPO')).toMatchObject({ type: 'matrix', stage: 'tipoGasto' });
    expect(who('T26')).toMatchObject({ type: 'matrix', stage: 'tipoGasto' });
    expect(who('T27')).toMatchObject({ type: 'matrix', stage: 'tipoGasto' });
    expect(who('T01')).toEqual({ type: 'initiator' });
    expect(ADQUISICIONES_FLOW.steps.find((s) => s.id === 'T01b')).toBeUndefined();
    expect(ADQUISICIONES_FLOW.steps.find((s) => s.id === 'T25')).toBeUndefined(); // fusionado en T22
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
