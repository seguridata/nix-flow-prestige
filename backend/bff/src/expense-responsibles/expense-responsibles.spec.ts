/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import { ExpenseResponsiblesController } from './expense-responsibles.controller';
import { ExpenseResponsiblesService } from './expense-responsibles.service';
import { MAX_IMPORT_ROWS, parseRow, pickResponsible, type Candidate } from './expense-responsibles.resolver';

let n = 0;
const row = (o: Partial<Candidate> = {}): Candidate => ({
  id: `r${++n}`,
  area: '*',
  expenseType: null,
  concept: null,
  stage: 'tipoGasto',
  minAmount: null,
  maxAmount: null,
  signerId: `s${n}`,
  name: `Nombre ${n}`,
  email: `s${n}@x.mx`,
  active: true,
  ...o,
});

describe('pickResponsible', () => {
  it('etapa area: coincide el área (sin importar mayúsculas) y no otra', () => {
    const rows = [row({ stage: 'area', area: 'QA', signerId: 'qa' }), row({ stage: 'area', area: 'RH', signerId: 'rh' })];
    expect(pickResponsible(rows, { stage: 'area', area: ' qa ' })?.signerId).toBe('qa');
    expect(pickResponsible(rows, { stage: 'area', area: 'Soporte' })).toBeNull();
  });

  it('solo considera la etapa pedida y filas activas', () => {
    const rows = [row({ stage: 'area', area: 'QA', signerId: 'a' }), row({ stage: 'tipoGasto', area: 'QA', signerId: 'b', active: false })];
    expect(pickResponsible(rows, { stage: 'tipoGasto', area: 'QA' })).toBeNull();
    expect(pickResponsible(rows, { stage: 'area', area: 'QA' })?.signerId).toBe('a');
  });

  it('etapa tipoGasto: tipo null = cualquiera; el tipo concreto debe coincidir', () => {
    const rows = [row({ expenseType: 'Marketing', signerId: 'mkt' }), row({ signerId: 'cualquiera' })];
    expect(pickResponsible(rows, { stage: 'tipoGasto', expenseType: 'Marketing' })?.signerId).toBe('mkt');
    expect(pickResponsible(rows, { stage: 'tipoGasto', expenseType: 'Viaje' })?.signerId).toBe('cualquiera');
  });

  it('concepto > tipo de gasto > ninguno', () => {
    const rows = [
      row({ signerId: 'general' }),
      row({ expenseType: 'Gastos de oficina, seguros y comunicación', signerId: 'tipo' }),
      row({ expenseType: 'Gastos de oficina, seguros y comunicación', concept: 'Renta oficinas', signerId: 'concepto' }),
    ];
    const q = { stage: 'tipoGasto' as const, expenseType: 'Gastos de oficina, seguros y comunicación' };
    expect(pickResponsible(rows, { ...q, concept: 'Renta oficinas' })?.signerId).toBe('concepto');
    expect(pickResponsible(rows, { ...q, concept: 'Mensajería' })?.signerId).toBe('tipo');
    expect(pickResponsible(rows, { stage: 'tipoGasto', expenseType: 'Viaje', concept: 'Gastos de Viaje' })?.signerId).toBe('general');
  });

  it('un concepto distinto al de la fila la excluye', () => {
    expect(pickResponsible([row({ concept: 'Renta oficinas' })], { stage: 'tipoGasto', concept: 'Mensajería' })).toBeNull();
  });

  it('el monto debe caer en [min, max] (extremos incluidos; null = sin límite)', () => {
    const rows = [row({ maxAmount: 10_000, signerId: 'jefe' }), row({ minAmount: 10_000.01, maxAmount: 100_000, signerId: 'dir' }), row({ minAmount: 100_000.01, signerId: 'dg' })];
    const at = (amount: number) => pickResponsible(rows, { stage: 'tipoGasto', amount })?.signerId;
    expect(at(0)).toBe('jefe');
    expect(at(10_000)).toBe('jefe');
    expect(at(10_000.01)).toBe('dir');
    expect(at(100_000)).toBe('dir');
    expect(at(5_000_000)).toBe('dg');
  });

  it('a igualdad de especificidad gana la de menor tope', () => {
    const rows = [row({ signerId: 'sin-tope' }), row({ maxAmount: 50_000, signerId: 'tope-50k' }), row({ maxAmount: 90_000, signerId: 'tope-90k' })];
    expect(pickResponsible(rows, { stage: 'tipoGasto', amount: 1 })?.signerId).toBe('tope-50k');
  });

  it('el área concreta desempata frente a «*»', () => {
    const rows = [row({ signerId: 'toda' }), row({ area: 'Comercial', signerId: 'comercial' })];
    expect(pickResponsible(rows, { stage: 'tipoGasto', area: 'Comercial' })?.signerId).toBe('comercial');
    expect(pickResponsible(rows, { stage: 'tipoGasto', area: 'QA' })?.signerId).toBe('toda');
  });

  it('el devuelto no trae más que signerId, name y email', () => {
    expect(Object.keys(pickResponsible([row()], { stage: 'tipoGasto' })!).sort()).toEqual(['email', 'name', 'signerId']);
  });
});

describe('parseRow', () => {
  const ok = { area: 'QA', stage: 'area', signerId: 'maria' };
  it('acepta una fila mínima y aplica los defaults', () => {
    expect(parseRow(ok, 'Fila 1').row).toEqual({ area: 'QA', expenseType: null, concept: null, stage: 'area', minAmount: null, maxAmount: null, signerId: 'maria', name: null, email: null, active: true });
  });
  it('en tipoGasto el área puede faltar (= «*»), en area no', () => {
    expect(parseRow({ stage: 'tipoGasto', signerId: 'x', area: null, concept: 'Renta oficinas' }, 'F').row?.area).toBe('*');
    expect(parseRow({ stage: 'area', signerId: 'x', area: null }, 'F').errors.join()).toContain('área');
  });
  it.each([
    [{ ...ok, stage: 'otra' }, 'etapa'],
    [{ ...ok, signerId: '' }, 'signerId'],
    [{ ...ok, email: 'no-es-correo' }, 'correo'],
    [{ ...ok, minAmount: -1 }, 'monto mínimo'],
    [{ ...ok, minAmount: 10, maxAmount: 5 }, 'mayor'],
    [{ ...ok, maxAmount: 'mucho' }, 'monto máximo'],
    [{ ...ok, active: 'si' }, 'activo'],
    [{ ...ok, area: 'x'.repeat(81) }, 'máximo'],
    ['texto', 'formato'],
  ])('rechaza %j', (raw, fragment) => {
    const { row: r, errors } = parseRow(raw, 'Fila 1');
    expect(r).toBeUndefined();
    expect(errors.join(' | ')).toContain(fragment);
  });
});

/** Prisma en memoria: respeta tenantId, active, stage y los where por id; lo demás lo filtra `pickResponsible`. */
function fake(initial: any[] = []) {
  const db: any[] = [...initial];
  let id = 0;
  const match = (r: any, w: any) =>
    (w.tenantId === undefined || r.tenantId === w.tenantId) &&
    (w.id === undefined || (typeof w.id === 'string' ? r.id === w.id : !w.id.in || w.id.in.includes(r.id))) &&
    (w.active === undefined || r.active === w.active) &&
    (w.stage === undefined || (w.stage.in ? w.stage.in.includes(r.stage) : r.stage === w.stage));
  const expenseResponsible = {
    findMany: vi.fn(async ({ where }: any) => db.filter((r) => match(r, where))),
    findFirst: vi.fn(async ({ where }: any) => db.find((r) => match(r, where)) ?? null),
    create: vi.fn(async ({ data }: any) => { const r = { id: `new${++id}`, ...data }; db.push(r); return r; }),
    createMany: vi.fn(async ({ data }: any) => { data.forEach((d: any) => db.push({ id: `imp${++id}`, ...d })); return { count: data.length }; }),
    updateMany: vi.fn(async ({ where, data }: any) => { const hit = db.filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const hit = db.filter((r) => match(r, where));
      hit.forEach((r) => db.splice(db.indexOf(r), 1));
      return { count: hit.length };
    }),
  };
  const prisma = { expenseResponsible, $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)) };
  const audit = { append: vi.fn(async () => ({})) };
  const svc = new ExpenseResponsiblesService(prisma as any, audit as any);
  return { svc, db, expenseResponsible, audit };
}

const A = { tenantId: 'acme', actorId: 'admin-a', name: 'Admin A' };
const B = { tenantId: 'beta', actorId: 'admin-b', name: 'Admin B' };
const stored = (o: any) => ({ id: `x${++n}`, area: '*', expenseType: null, concept: null, stage: 'tipoGasto', minAmount: null, maxAmount: null, name: 'N', email: 'n@x.mx', active: true, ...o });

describe('ExpenseResponsiblesService - resolución por tenant', () => {
  it('el tenant A nunca ve las filas del tenant B', async () => {
    const { svc } = fake([stored({ tenantId: 'beta', signerId: 'de-b' }), stored({ tenantId: 'acme', signerId: 'de-a' })]);
    expect((await svc.resolve('acme', { stage: 'tipoGasto' })).match?.signerId).toBe('de-a');
    expect((await svc.resolve('beta', { stage: 'tipoGasto' })).match?.signerId).toBe('de-b');
    expect((await svc.resolve('otro', { stage: 'tipoGasto' })).match).toBeNull();
  });

  it('ignora las filas inactivas', async () => {
    const { svc } = fake([stored({ tenantId: 'acme', signerId: 'apagado', active: false })]);
    expect((await svc.resolve('acme', { stage: 'tipoGasto' })).match).toBeNull();
  });

  it('convierte los montos Decimal a número y usa concepto + monto', async () => {
    const dec = (v: number) => ({ toString: () => String(v), valueOf: () => v });
    const { svc } = fake([
      stored({ tenantId: 'acme', concept: 'Renta oficinas', maxAmount: dec(1000) as any, signerId: 'chico' }),
      stored({ tenantId: 'acme', concept: 'Renta oficinas', minAmount: dec(1000.01) as any, signerId: 'grande' }),
    ]);
    expect((await svc.resolve('acme', { stage: 'tipoGasto', concept: 'Renta oficinas', amount: 500 })).match?.signerId).toBe('chico');
    expect((await svc.resolve('acme', { stage: 'tipoGasto', concept: 'Renta oficinas', amount: 5000 })).match?.signerId).toBe('grande');
  });

  it('candidates: una sola consulta, acotada al tenant y a filas activas', async () => {
    const { svc, expenseResponsible } = fake([]);
    await svc.candidates('acme', ['area', 'tipoGasto'], { area: 'QA', expenseType: 'Marketing', concept: 'x' });
    expect(expenseResponsible.findMany).toHaveBeenCalledTimes(1);
    expect(expenseResponsible.findMany.mock.calls[0]![0].where).toMatchObject({ tenantId: 'acme', active: true, stage: { in: ['area', 'tipoGasto'] } });
  });
});

describe('ExpenseResponsiblesService - alta, cambio y baja', () => {
  it('create guarda con el tenant del guard y audita sin datos personales', async () => {
    const { svc, db, audit } = fake();
    const out = await svc.create({ area: 'QA', stage: 'area', signerId: 'maria', name: 'María', email: 'maria@x.mx', tenantId: 'beta' } as any, A);
    expect(db[0].tenantId).toBe('acme'); // el cuerpo no puede cambiar el tenant
    expect(out).not.toHaveProperty('tenantId');
    const call = (audit.append.mock.calls as any[])[0]![0];
    expect(call).toMatchObject({ tenantId: 'acme', actorId: 'admin-a', action: 'EXPENSE_RESPONSIBLE_CREATED' });
    expect(JSON.stringify(call.payload)).not.toMatch(/María|maria@/);
  });

  it('update y remove de una fila de otro tenant → 404 y no la tocan', async () => {
    const { svc, db } = fake([stored({ id: 'ajena', tenantId: 'beta', area: 'QA', stage: 'area', signerId: 'b' })]);
    await expect(svc.update('ajena', { signerId: 'robado' }, A)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove('ajena', A)).rejects.toBeInstanceOf(NotFoundException);
    expect(db[0].signerId).toBe('b');
    expect(db).toHaveLength(1);
  });

  it('update es parcial y revalida', async () => {
    const { svc, db } = fake([stored({ id: 'mia', tenantId: 'acme', area: 'QA', stage: 'area', signerId: 'a', maxAmount: 10 })]);
    const out = await svc.update('mia', { signerId: 'nuevo' }, A);
    expect(out).toMatchObject({ id: 'mia', signerId: 'nuevo', area: 'QA', maxAmount: 10 });
    expect(db[0].signerId).toBe('nuevo');
    await expect(svc.update('mia', { minAmount: 99 }, A)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ExpenseResponsiblesService.importRows', () => {
  const r = (i: number) => ({ stage: 'tipoGasto', concept: `C${i}`, signerId: `s${i}` });

  it('límites: vacío y más de 500 filas → 400 sin escribir', async () => {
    const { svc, expenseResponsible } = fake();
    await expect(svc.importRows([], false, A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.importRows(Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => r(i)), false, A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.importRows('no', false, A)).rejects.toBeInstanceOf(BadRequestException);
    expect(expenseResponsible.createMany).not.toHaveBeenCalled();
  });

  it('acepta exactamente 500 filas', async () => {
    const { svc, db } = fake();
    await expect(svc.importRows(Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => r(i)), false, A)).resolves.toEqual({ imported: 500, deleted: 0 });
    expect(db).toHaveLength(500);
  });

  it('validación estricta: una fila mala invalida todo, con el número de fila', async () => {
    const { svc, expenseResponsible } = fake();
    const err: any = await svc.importRows([r(1), { ...r(2), signerId: '' }, { ...r(3), stage: 'x' }], true, A).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().errors.join(' ')).toMatch(/Fila 2.*Fila 3/);
    expect(expenseResponsible.deleteMany).not.toHaveBeenCalled();
    expect(expenseResponsible.createMany).not.toHaveBeenCalled();
  });

  it('sin replace conserva lo existente; todas las filas nuevas quedan en el tenant del guard', async () => {
    const { svc, db } = fake([stored({ tenantId: 'acme', signerId: 'previo' })]);
    await expect(svc.importRows([r(1), { ...r(2), tenantId: 'beta' }], false, A)).resolves.toEqual({ imported: 2, deleted: 0 });
    expect(db).toHaveLength(3);
    expect(db.every((x) => x.tenantId === 'acme')).toBe(true);
  });

  it('replace borra SOLO las del tenant', async () => {
    const { svc, db, expenseResponsible } = fake([
      stored({ tenantId: 'acme', signerId: 'a1' }),
      stored({ tenantId: 'acme', signerId: 'a2' }),
      stored({ tenantId: 'beta', signerId: 'b1' }),
    ]);
    await expect(svc.importRows([r(1)], true, A)).resolves.toEqual({ imported: 1, deleted: 2 });
    expect(expenseResponsible.deleteMany.mock.calls[0]![0].where).toEqual({ tenantId: 'acme' });
    expect(db.filter((x) => x.tenantId === 'beta').map((x) => x.signerId)).toEqual(['b1']);
    expect(db.filter((x) => x.tenantId === 'acme')).toHaveLength(1);
    void B;
  });

  it('audita la importación solo con conteos', async () => {
    const { svc, audit } = fake();
    await svc.importRows([r(1)], true, A);
    expect((audit.append.mock.calls as any[])[0]![0]).toMatchObject({ tenantId: 'acme', actorId: 'admin-a', action: 'EXPENSE_RESPONSIBLES_IMPORTED', payload: { count: 1, replace: true, deleted: 0 } });
  });
});

describe('ExpenseResponsiblesController - roles', () => {
  const proto = ExpenseResponsiblesController.prototype as any;
  it('todo es solo admin salvo resolve', () => {
    for (const m of ['list', 'create', 'update', 'remove', 'import']) expect(Reflect.getMetadata(ROLES_KEY, proto[m])).toEqual(['admin']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.resolve)).toBeUndefined();
  });
  it('resolve y list usan el tenant del guard', async () => {
    const service = { resolve: vi.fn(async () => ({ match: null })), list: vi.fn(async () => []) };
    const c = new ExpenseResponsiblesController(service as any);
    const user: any = { tenantId: 'acme', actorId: 'u', roles: [] };
    await c.resolve({ stage: 'area', area: 'QA' } as any, user);
    await c.list({} as any, user);
    expect((service.resolve.mock.calls as any[])[0]![0]).toBe('acme');
    expect((service.list.mock.calls as any[])[0]![0]).toBe('acme');
  });
});
