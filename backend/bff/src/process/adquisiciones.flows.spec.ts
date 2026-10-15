/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ADQUISICIONES_FLOW, PROVEEDORES_ESTRATEGICOS_FLOW, RENOVACION_LICENCIAS_FLOW, TIPOS_GASTO } from './adquisiciones.flows';
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

  const TRONCO = ['T01', 'T01b', 'T02', 'T04', 'T05', 'T16'];

  it('Bienes y servicios: orden de compra, solicitud al proveedor y recepción hasta el pago', () => {
    expect(activos('Bienes y servicios')).toEqual([...TRONCO.slice(0, 5), 'T09', 'T16', 'T18', 'T22', 'T25', 'T26', 'T27']);
  });

  it('Costo de venta directo: cotización Entrust, OC, aduana y recepción', () => {
    expect(activos('Costo de venta directo (Entrust)')).toEqual([...TRONCO.slice(0, 5), 'T07', 'T09', 'T16', 'T19', 'T22', 'T25', 'T26', 'T27']);
  });

  it('Oficina, seguros y comunicación: reembolso/comprobantes y pago con tarjeta; sin recepción ni orden de compra', () => {
    expect(activos('Gastos de oficina, seguros y comunicación')).toEqual([...TRONCO.slice(0, 5), 'T14', 'T16', 'T30']);
  });

  it('Marketing: comprobantes y anticipo/saldo; sin orden de compra', () => {
    expect(activos('Marketing')).toEqual([...TRONCO.slice(0, 5), 'T14', 'T16', 'T17']);
  });

  it('Viaje: reserva, 3 agencias, conformidad y anticipo/saldo', () => {
    expect(activos('Viaje')).toEqual([...TRONCO.slice(0, 5), 'T10', 'T11', 'T13', 'T16', 'T17']);
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
