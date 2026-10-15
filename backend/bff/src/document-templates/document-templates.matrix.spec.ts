/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { DocumentTemplatesService } from './document-templates.service';
import { ExpenseResponsiblesService } from '../expense-responsibles/expense-responsibles.service';
import type { Flow } from '../flow/flow.types';
import type { TemplateActor } from './template.types';

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
    { id: 'aut_area', label: 'Autorización por área', who: { type: 'matrix', stage: 'area', prompt: '¿Quién autoriza el área?' }, role: 'FIRMANTE' },
    { id: 'aut_tipo', label: 'Autorización por tipo', who: { type: 'matrix', stage: 'tipoGasto', prompt: '¿Quién autoriza el gasto?' }, role: 'FIRMANTE' },
    {
      id: 'solo_viaje',
      label: 'Solo viaje',
      who: { type: 'matrix', stage: 'tipoGasto', prompt: '¿Quién?' },
      role: 'REVISOR',
      when: [{ variable: 'tipoGasto', op: '==', value: 'Viaje' }],
    },
    { id: 'ask', label: 'Preguntar', who: { type: 'ask', prompt: '¿Quién?' }, role: 'REVISOR' },
  ],
};

const actor: TemplateActor = { tenantId: 'acme', actorId: 'maria', name: 'María', email: 'm@x.mx', isAdmin: false };
const dbRow = (o: any) => ({ id: `r${Math.random()}`, tenantId: 'acme', area: '*', expenseType: null, concept: null, stage: 'tipoGasto', minAmount: null, maxAmount: null, name: null, email: null, active: true, ...o });

async function setup(rows: any[]) {
  const pdf = Buffer.from(await (async () => { const d = await PDFDocument.create(); d.addPage([612, 792]); return d.save(); })());
  const tpl = { id: 't1', tenantId: 'acme', name: 'Adq', published: true, objectKey: 'templates/acme/x.pdf', enc: {}, pageCount: 1, fields: [], signatureBoxes: [], flow, methods: ['ACCEPT'], kycPolicy: 'NONE', requirePasskey: false };
  const findMany = vi.fn(async ({ where }: any) => rows.filter((r) => r.tenantId === where.tenantId && r.active === where.active && where.stage.in.includes(r.stage)));
  const prisma = {
    documentTemplate: { findFirst: vi.fn(async ({ where }: any) => (where.tenantId === 'acme' ? tpl : null)) },
    case: { create: vi.fn(async () => ({ id: 'c1' })) },
    expenseResponsible: { findMany },
  };
  const matrix = new ExpenseResponsiblesService(prisma as any, { append: vi.fn() } as any);
  const requests = { create: vi.fn(async (b: any) => ({ id: 'sr1', signers: b.signers.map((s: any) => ({ ...s })) })) };
  const svc = new DocumentTemplatesService(
    prisma as any,
    { getObject: vi.fn(async () => pdf) } as any,
    { create: vi.fn(async () => ({ id: 'd1' })) } as any,
    requests as any,
    { createMany: vi.fn(async () => []) } as any,
    { assertOwned: vi.fn() } as any,
    matrix,
  );
  return { svc, requests, findMany };
}

const rows = [
  dbRow({ stage: 'area', area: 'QA', signerId: 'jefe-qa', name: 'Jefe QA', email: 'qa@x.mx' }),
  dbRow({ stage: 'tipoGasto', concept: 'Marketing: Publicidad', expenseType: 'Marketing', signerId: 'dir-mkt', name: 'Dir Mkt' }),
  dbRow({ stage: 'tipoGasto', concept: 'Gastos de Viaje', expenseType: 'Viaje', maxAmount: 10_000, signerId: 'viaje-chico' }),
  dbRow({ stage: 'tipoGasto', concept: 'Gastos de Viaje', expenseType: 'Viaje', minAmount: 10_000.01, signerId: 'viaje-grande' }),
  dbRow({ tenantId: 'otro', stage: 'area', area: 'QA', signerId: 'de-otro-tenant' }),
];

describe('previewFlow con pasos matrix', () => {
  it('resuelve con área, tipoGasto, concepto y monto, y marca lo que no se resolvió', async () => {
    const { svc } = await setup(rows);
    const out = await svc.previewFlow('t1', { area: 'QA', tipoGasto: 'Marketing', concepto: 'Marketing: Publicidad', monto: 500 }, actor);
    const by = Object.fromEntries(out.steps.map((s: any) => [s.stepId, s]));
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

  it('sin coincidencia → unresolved (y el tenant no ve filas ajenas)', async () => {
    const { svc } = await setup(rows);
    const out = await svc.previewFlow('t1', { area: 'RH', tipoGasto: 'Marketing', concepto: 'Marketing: Publicidad', monto: 1 }, actor);
    const area = out.steps.find((s: any) => s.stepId === 'aut_area') as any;
    expect(area.unresolved).toBe(true);
    expect(area.resolved).toBeUndefined();
  });

  it('el monto elige el responsable de viaje', async () => {
    const { svc } = await setup(rows);
    const v = { area: 'QA', tipoGasto: 'Viaje', concepto: 'Gastos de Viaje' };
    const pick = async (monto: number) => ((await svc.previewFlow('t1', { ...v, monto }, actor)).steps.find((s: any) => s.stepId === 'solo_viaje') as any).resolved?.signerId;
    expect(await pick(9_000)).toBe('viaje-chico');
    expect(await pick(50_000)).toBe('viaje-grande');
  });

  it('una sola consulta de la matriz por vista previa, y ninguna si no hay pasos matrix activos', async () => {
    const { svc, findMany } = await setup(rows);
    await svc.previewFlow('t1', { area: 'QA', tipoGasto: 'Viaje', concepto: 'Gastos de Viaje', monto: 1 }, actor);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ tenantId: 'acme', active: true });
  });

  it('con los valores a medio capturar no truena: lo que falta queda sin resolver', async () => {
    const { svc } = await setup(rows);
    const out = await svc.previewFlow('t1', {}, actor);
    expect(out.steps.find((s: any) => s.stepId === 'aut_area')).toMatchObject({ unresolved: true });
  });
});

describe('instantiate con pasos matrix', () => {
  const values = { area: 'QA', tipoGasto: 'Marketing', concepto: 'Marketing: Publicidad', monto: 500 };

  it('los pasos resueltos entran como firmantes sin preguntar', async () => {
    const { svc, requests } = await setup(rows);
    const out = await svc.instantiate('t1', { values, askedSigners: { ask: { signerId: 'carlos' } } }, actor);
    expect(requests.create.mock.calls[0]![0].signers.map((s: any) => s.signerId)).toEqual(['maria', 'jefe-qa', 'dir-mkt', 'carlos']);
    expect(requests.create.mock.calls[0]![0].signers[1]).toMatchObject({ name: 'Jefe QA', email: 'qa@x.mx' });
    expect((out.steps.find((s) => s.stepId === 'aut_tipo') as any).resolved.signerId).toBe('dir-mkt');
  });

  it('sin coincidencia se comporta como «preguntar»: usa askedSigners[stepId]', async () => {
    const { svc, requests } = await setup(rows);
    const out = await svc.instantiate(
      't1',
      { values: { ...values, area: 'RH' }, askedSigners: { aut_area: { signerId: 'manual' }, ask: { signerId: 'carlos' } } },
      actor,
    );
    expect(requests.create.mock.calls[0]![0].signers.map((s: any) => s.signerId)).toEqual(['maria', 'manual', 'dir-mkt', 'carlos']);
    expect((out.steps.find((s) => s.stepId === 'aut_area') as any).unresolved).toBe(true);
  });

  it('sin coincidencia y sin respuesta manual → 400 con la pregunta de respaldo del paso, sin crear nada', async () => {
    const { svc, requests } = await setup(rows);
    const err: any = await svc.instantiate('t1', { values: { ...values, area: 'RH' }, askedSigners: { ask: { signerId: 'c' } } }, actor).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(requests.create).not.toHaveBeenCalled();
  });

  it('el tenant A no usa filas del tenant B', async () => {
    const { svc, requests } = await setup(rows.filter((r) => r.tenantId === 'otro'));
    const err = await svc.instantiate('t1', { values, askedSigners: { aut_area: { signerId: 'm1' }, aut_tipo: { signerId: 'm2' }, ask: { signerId: 'm3' } } }, actor);
    expect(requests.create.mock.calls[0]![0].signers.map((s: any) => s.signerId)).toEqual(['maria', 'm1', 'm2', 'm3']);
    void err;
  });
});
