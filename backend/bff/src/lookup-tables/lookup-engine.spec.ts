import { describe, expect, it } from 'vitest';
import type { LookupCondition, LookupOp, LookupQuery } from '../flow/flow.types';
import {
  columnMap,
  dryRun,
  evaluateCondition,
  evaluateRow,
  normText,
  opAllowedFor,
  parseDate,
  parseList,
  parseNumber,
  runLookup,
  type EngineRow,
  type EngineTable,
  type LookupColumn,
} from './lookup-engine';

const columns: LookupColumn[] = [
  { key: 'txt', label: 'Texto', type: 'text' },
  { key: 'num', label: 'Número', type: 'number' },
  { key: 'fecha', label: 'Fecha', type: 'date' },
  { key: 'sel', label: 'Selección', type: 'select', options: ['Uno', 'Dos'] },
  { key: 'lista', label: 'Lista', type: 'text' },
  { key: 'nums', label: 'Números', type: 'number' },
];
const cols = columnMap(columns);

const check = (c: LookupCondition, cell: unknown, inputs: Record<string, string | number> = {}) =>
  evaluateCondition(c, 0, { values: { [c.column]: cell } }, cols, inputs);
const ok = (c: LookupCondition, cell: unknown, inputs?: Record<string, string | number>) => check(c, cell, inputs).ok;

const cond = (column: string, op: LookupOp, req?: string | number, extra: Partial<LookupCondition> = {}): LookupCondition => ({
  column,
  op,
  ...(req === undefined ? {} : { source: { value: req } }),
  ...extra,
});

describe('normalización', () => {
  it('normText quita mayúsculas, acentos y espacios de más', () => {
    expect(normText('  ÁREA   de  Nómina ')).toBe('area de nomina');
    expect(normText(null)).toBe('');
    expect(normText(42)).toBe('42');
  });
  it('parseNumber acepta números y cadenas numéricas, nada más', () => {
    expect(parseNumber(5)).toBe(5);
    expect(parseNumber(' -3.50 ')).toBe(-3.5);
    for (const bad of ['', 'abc', '1,000', '1e3', NaN, Infinity, null, undefined, {}, true]) expect(parseNumber(bad)).toBeNull();
  });
  it('parseDate acepta ISO real (con hora) y rechaza fechas imposibles', () => {
    expect(parseDate('2026-02-28')).toBe('2026-02-28');
    expect(parseDate('2026-02-28T10:00:00Z')).toBe('2026-02-28');
    for (const bad of ['2026-02-30', '2026-13-01', '28/02/2026', '2026-2-8', '', null, 20260228]) expect(parseDate(bad)).toBeNull();
  });
  it('parseList separa por ; o , y descarta vacíos', () => {
    expect(parseList('a; b,c ;;, ')).toEqual(['a', 'b', 'c']);
    expect(parseList(null)).toEqual([]);
    expect(parseList(7)).toEqual(['7']);
  });
  it('opAllowedFor: ordenados solo número/fecha, de texto solo texto/select', () => {
    expect(opAllowedFor('gt', 'number')).toBe(true);
    expect(opAllowedFor('lte', 'date')).toBe(true);
    expect(opAllowedFor('gt', 'text')).toBe(false);
    expect(opAllowedFor('contains', 'number')).toBe(false);
    expect(opAllowedFor('startsWith', 'select')).toBe(true);
    expect(opAllowedFor('eq', 'date')).toBe(true);
    expect(opAllowedFor('in', 'number')).toBe(true);
  });
});

describe('eq / neq', () => {
  it('texto sin distinguir mayúsculas ni acentos', () => {
    expect(ok(cond('txt', 'eq', 'NÓMINA'), 'nomina')).toBe(true);
    expect(ok(cond('txt', 'eq', 'Renta'), 'Renta oficinas')).toBe(false);
    expect(ok(cond('txt', 'neq', 'Renta'), 'Renta oficinas')).toBe(true);
    expect(ok(cond('txt', 'neq', 'nómina'), 'NOMINA')).toBe(false);
  });
  it('select se compara como texto', () => {
    expect(ok(cond('sel', 'eq', 'uno'), 'Uno')).toBe(true);
    expect(ok(cond('sel', 'neq', 'Dos'), 'Uno')).toBe(true);
  });
  it('números por valor: 500 = «500.0» y un texto no numérico no coincide', () => {
    expect(ok(cond('num', 'eq', 500), 500)).toBe(true);
    expect(ok(cond('num', 'eq', '500.0'), 500)).toBe(true);
    expect(ok(cond('num', 'eq', 501), 500)).toBe(false);
    expect(ok(cond('num', 'neq', 501), 500)).toBe(true);
    const bad = check(cond('num', 'eq', 'abc'), 500);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('no es un número');
    // un valor no numérico NO cuenta como «diferente»: la condición no se cumple
    expect(ok(cond('num', 'neq', 'abc'), 500)).toBe(false);
  });
  it('fechas por valor (con o sin hora)', () => {
    expect(ok(cond('fecha', 'eq', '2026-03-04T08:00:00Z'), '2026-03-04')).toBe(true);
    expect(ok(cond('fecha', 'eq', '2026-03-05'), '2026-03-04')).toBe(false);
    expect(ok(cond('fecha', 'neq', '2026-03-05'), '2026-03-04')).toBe(true);
    expect(ok(cond('fecha', 'eq', '04/03/2026'), '2026-03-04')).toBe(false);
  });
  it('lee el valor de la solicitud de una variable', () => {
    const c: LookupCondition = { column: 'txt', op: 'eq', source: { var: 'area' } };
    expect(ok(c, 'QA', { area: 'qa' })).toBe(true);
    expect(ok(c, 'QA', { area: 'RH' })).toBe(false);
  });
});

describe('gt / gte / lt / lte  («solicitud» OP «fila»)', () => {
  it('número: la solicitud es el lado izquierdo', () => {
    // monto 500 gte montoMin 100  →  500 ≥ 100
    expect(ok(cond('num', 'gte', 500), 100)).toBe(true);
    expect(ok(cond('num', 'gt', 500), 500)).toBe(false);
    expect(ok(cond('num', 'gte', 500), 500)).toBe(true);
    expect(ok(cond('num', 'lt', 500), 1000)).toBe(true);
    expect(ok(cond('num', 'lt', 500), 500)).toBe(false);
    expect(ok(cond('num', 'lte', 500), 500)).toBe(true);
    expect(ok(cond('num', 'lte', 501), 500)).toBe(false);
    expect(ok(cond('num', 'gt', 10), '9.5')).toBe(true); // la celda numérica en texto sigue valiendo
  });
  it('fecha ISO por valor', () => {
    expect(ok(cond('fecha', 'gt', '2026-03-05'), '2026-03-04')).toBe(true);
    expect(ok(cond('fecha', 'lte', '2026-03-04'), '2026-03-04')).toBe(true);
    expect(ok(cond('fecha', 'lt', '2026-03-04'), '2026-03-04')).toBe(false);
    expect(ok(cond('fecha', 'gte', '2026-03-03'), '2026-03-04')).toBe(false);
  });
  it('solo number y date: en texto o select nunca se cumplen, y lo explican', () => {
    for (const col of ['txt', 'sel']) {
      for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
        const r = check(cond(col, op, 'b'), 'a');
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('solo aplica a columnas de número o fecha');
      }
    }
  });
  it('valor de la solicitud o de la fila que no es número/fecha → no se cumple, sin lanzar', () => {
    expect(ok(cond('num', 'gt', 'abc'), 1)).toBe(false);
    expect(ok(cond('num', 'gt', 5), 'abc')).toBe(false);
    expect(ok(cond('fecha', 'gt', 'ayer'), '2026-03-04')).toBe(false);
    expect(ok(cond('fecha', 'gt', '2026-03-05'), 'hoy')).toBe(false);
  });
});

describe('contains / notContains / startsWith / endsWith (la solicitud contiene el texto de la fila)', () => {
  it('contains: el valor de la solicitud CONTIENE el texto de la fila, no al revés', () => {
    expect(ok(cond('txt', 'contains', 'Renta de oficinas centro'), 'oficinas')).toBe(true);
    expect(ok(cond('txt', 'contains', 'oficinas'), 'Renta de oficinas')).toBe(false);
  });
  it('sin mayúsculas ni acentos', () => {
    expect(ok(cond('txt', 'contains', 'SERVICIO DE NÓMINA'), 'nomina')).toBe(true);
    expect(ok(cond('txt', 'notContains', 'Servicio de nómina'), 'nomina')).toBe(false);
    expect(ok(cond('txt', 'notContains', 'Marketing'), 'nomina')).toBe(true);
  });
  it('startsWith / endsWith', () => {
    expect(ok(cond('txt', 'startsWith', 'Marketing: Publicidad'), 'marketing')).toBe(true);
    expect(ok(cond('txt', 'startsWith', 'Publicidad Marketing'), 'marketing')).toBe(false);
    expect(ok(cond('txt', 'endsWith', 'Gastos de Viaje'), 'VIAJE')).toBe(true);
    expect(ok(cond('txt', 'endsWith', 'Viaje largo'), 'viaje')).toBe(false);
  });
  it('solo texto: en número o fecha no se cumplen', () => {
    for (const op of ['contains', 'notContains', 'startsWith', 'endsWith'] as const) {
      expect(check(cond('num', op, '5'), 5).reason).toContain('solo aplica a columnas de texto');
      expect(ok(cond('fecha', op, '2026'), '2026-01-01')).toBe(false);
    }
  });
});

describe('in / notIn (la celda trae la lista)', () => {
  it('lista con ; o , sin importar mayúsculas, acentos ni espacios', () => {
    expect(ok(cond('lista', 'in', 'qa'), 'QA; RH, Soporte')).toBe(true);
    expect(ok(cond('lista', 'in', 'rh'), 'QA; RH, Soporte')).toBe(true);
    expect(ok(cond('lista', 'in', 'SOPORTE'), 'QA; RH, Soporte')).toBe(true);
    expect(ok(cond('lista', 'in', 'Comercial'), 'QA; RH, Soporte')).toBe(false);
    expect(ok(cond('lista', 'notIn', 'Comercial'), 'QA; RH, Soporte')).toBe(true);
    expect(ok(cond('lista', 'notIn', 'qa'), 'QA; RH, Soporte')).toBe(false);
    expect(ok(cond('lista', 'in', 'Nómina'), 'nomina;otro')).toBe(true);
  });
  it('es pertenencia exacta, no contiene', () => {
    expect(ok(cond('lista', 'in', 'Q'), 'QA;RH')).toBe(false);
  });
  it('en columnas numéricas compara por valor; en fechas, por fecha', () => {
    expect(ok(cond('num', 'in', 5), 5)).toBe(true);
    expect(ok(cond('nums', 'in', '2.0'), '1; 2; 3')).toBe(true);
    expect(ok(cond('nums', 'in', 4), '1; 2; 3')).toBe(false);
    expect(ok(cond('nums', 'notIn', 4), '1; 2; 3')).toBe(true);
    expect(ok(cond('fecha', 'in', '2026-03-04T09:00:00Z'), '2026-03-04; 2026-03-05')).toBe(true);
  });
  it('un valor de la solicitud que no es número en una columna numérica no se cumple (ni siquiera notIn)', () => {
    expect(ok(cond('nums', 'notIn', 'abc'), '1; 2')).toBe(false);
  });
});

describe('isEmpty / isNotEmpty (sin fuente: miran la celda de la fila)', () => {
  it('celda vacía = null, undefined, "" o solo espacios; el 0 NO es vacío', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(ok(cond('txt', 'isEmpty'), empty)).toBe(true);
      expect(ok(cond('txt', 'isNotEmpty'), empty)).toBe(false);
    }
    expect(ok(cond('num', 'isEmpty'), 0)).toBe(false);
    expect(ok(cond('num', 'isNotEmpty'), 0)).toBe(true);
    expect(ok(cond('txt', 'isNotEmpty'), 'x')).toBe(true);
  });
  it('emptyMatchesAny no les afecta', () => {
    expect(ok(cond('txt', 'isNotEmpty', undefined, { emptyMatchesAny: true }), '')).toBe(false);
    expect(ok(cond('txt', 'isEmpty', undefined, { emptyMatchesAny: false }), '')).toBe(true);
  });
});

describe('celdas vacías y emptyMatchesAny', () => {
  const ops: LookupOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn'];
  it('por defecto (true) una celda vacía cumple cualquier operador: es «cualquiera»', () => {
    for (const op of ops) {
      const col = ['gt', 'gte', 'lt', 'lte'].includes(op) ? 'num' : 'txt';
      expect(ok(cond(col, op, 'x'), '')).toBe(true);
      expect(ok(cond(col, op, 'x'), undefined)).toBe(true);
      expect(ok(cond(col, op, 'x', { emptyMatchesAny: true }), null)).toBe(true);
    }
  });
  it('aunque la solicitud no traiga valor, la celda vacía sigue valiendo «cualquiera»', () => {
    expect(ok({ column: 'txt', op: 'eq', source: { var: 'falta' } }, '', {})).toBe(true);
  });
  it('con emptyMatchesAny=false la celda vacía NO cumple', () => {
    for (const op of ops) {
      const col = ['gt', 'gte', 'lt', 'lte'].includes(op) ? 'num' : 'txt';
      const r = check(cond(col, op, 'x', { emptyMatchesAny: false }), '');
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('no admite «cualquiera»');
    }
  });
  it('celda con valor y solicitud sin valor: no se cumple (ningún dato autoriza a nadie)', () => {
    const c: LookupCondition = { column: 'txt', op: 'eq', source: { var: 'area' } };
    for (const inputs of [{}, { area: '' }, { area: '   ' }] as Record<string, string>[]) {
      const r = check(c, 'QA', inputs);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('no trae valor');
    }
    expect(ok({ column: 'txt', op: 'neq', source: { var: 'area' } }, 'QA', {})).toBe(false);
  });
  it('columna que no existe → no se cumple y lo dice', () => {
    const r = evaluateCondition({ column: 'nope', op: 'eq', source: { value: 1 } }, 3, { values: {} }, cols, {});
    expect(r).toMatchObject({ ok: false, index: 3, column: 'nope' });
    expect(r.reason).toContain('no existe');
  });
});

describe('evaluateRow', () => {
  it('une las condiciones con AND y se detiene en la primera que falla', () => {
    const row = { values: { txt: 'QA', num: 100 } };
    const conds: LookupCondition[] = [cond('txt', 'eq', 'qa'), cond('num', 'lte', 50), cond('fecha', 'isNotEmpty')];
    const ev = evaluateRow(row, conds, cols, {});
    expect(ev.matched).toBe(false);
    expect(ev.failedAt).toMatchObject({ index: 2, column: 'fecha', op: 'isNotEmpty' });
    expect(ev.checks).toHaveLength(3);
    const ev2 = evaluateRow({ values: { txt: 'RH' } }, conds, cols, {});
    expect(ev2.failedAt?.index).toBe(0);
    expect(ev2.checks).toHaveLength(1);
  });
  it('sin condiciones coincide (vacuidad)', () => {
    expect(evaluateRow({ values: {} }, [], cols, {}).matched).toBe(true);
  });
});

describe('runLookup: primera fila activa por position', () => {
  const row = (id: string, position: number, values: Record<string, unknown>, active = true): EngineRow => ({ id, position, active, values });
  const table = (rows: EngineRow[], revision = 7): EngineTable => ({ key: 'resp', revision, columns, rows });
  const q: LookupQuery = { table: 'resp', match: [{ column: 'txt', op: 'eq', source: { var: 'area' } }] };

  it('gana la de menor position aunque llegue después en el arreglo', () => {
    const t = table([row('b', 2, { txt: 'QA', sel: 'Dos' }), row('a', 1, { txt: 'QA', sel: 'Uno' })]);
    const r = runLookup(t, q, { area: 'QA' });
    expect(r.hit).toMatchObject({ rowId: 'a', position: 1, tableKey: 'resp', revision: 7 });
    expect(r.hit?.values.sel).toBe('Uno');
    expect(r.revision).toBe(7);
  });
  it('de lo específico a lo general: la fila vacía («cualquiera») solo gana si va antes', () => {
    const t = table([row('esp', 0, { txt: 'QA' }), row('gen', 1, {})]);
    expect(runLookup(t, q, { area: 'QA' }).hit?.rowId).toBe('esp');
    expect(runLookup(t, q, { area: 'RH' }).hit?.rowId).toBe('gen');
    const al_reves = table([row('gen', 0, {}), row('esp', 1, { txt: 'QA' })]);
    expect(runLookup(al_reves, q, { area: 'QA' }).hit?.rowId).toBe('gen');
  });
  it('ignora las filas inactivas', () => {
    const t = table([row('off', 0, { txt: 'QA' }, false), row('on', 5, { txt: 'QA' })]);
    expect(runLookup(t, q, { area: 'QA' }).hit?.rowId).toBe('on');
    expect(runLookup(table([row('off', 0, { txt: 'QA' }, false)]), q, { area: 'QA' }).hit).toBeNull();
  });
  it('a igual position desempata el id (determinista, sin depender del orden de entrada)', () => {
    const a = table([row('z', 1, { txt: 'QA' }), row('m', 1, { txt: 'QA' })]);
    const b = table([row('m', 1, { txt: 'QA' }), row('z', 1, { txt: 'QA' })]);
    expect(runLookup(a, q, { area: 'QA' }).hit?.rowId).toBe('m');
    expect(runLookup(b, q, { area: 'QA' }).hit?.rowId).toBe('m');
  });
  it('sin coincidencia: hit null, revisión de la tabla y cuántas filas se evaluaron', () => {
    const r = runLookup(table([row('a', 0, { txt: 'QA' }), row('b', 1, { txt: 'RH' })]), q, { area: 'Soporte' });
    expect(r).toEqual({ hit: null, revision: 7, evaluated: 2, trace: [] });
  });
  it('la traza explica la fila ganadora condición por condición', () => {
    const t = table([row('a', 0, { txt: 'QA', num: 100 })]);
    const r = runLookup(
      t,
      { table: 'resp', match: [{ column: 'txt', op: 'eq', source: { var: 'area' } }, { column: 'num', op: 'lte', source: { var: 'monto' } }] },
      { area: 'qa', monto: 100 },
    );
    expect(r.hit?.rowId).toBe('a');
    expect(r.trace.map((c) => [c.index, c.column, c.op, c.ok])).toEqual([[0, 'txt', 'eq', true], [1, 'num', 'lte', true]]);
    expect(r.trace[1]!.reason).toContain('es menor o igual que');
  });
  it('un rango con dos condiciones y celdas vacías = sin tope', () => {
    const t = table([
      row('chico', 0, { nums: 0, num: 10000 }),
      row('medio', 1, { nums: 10000.01, num: 100000 }),
      row('grande', 2, { nums: 100000.01 }),
    ]);
    const range: LookupQuery = {
      table: 'resp',
      match: [
        { column: 'nums', op: 'gte', source: { var: 'monto' } },
        { column: 'num', op: 'lte', source: { var: 'monto' } },
      ],
    };
    const at = (monto: number) => runLookup(t, range, { monto }).hit?.rowId;
    expect(at(0)).toBe('chico');
    expect(at(10000)).toBe('chico');
    expect(at(10000.01)).toBe('medio');
    expect(at(100000)).toBe('medio');
    expect(at(9_999_999)).toBe('grande');
  });
  it('no muta la tabla recibida', () => {
    const rows = [row('b', 2, { txt: 'QA' }), row('a', 1, { txt: 'QA' })];
    runLookup(table(rows), q, { area: 'QA' });
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('dryRun: explicación fila por fila', () => {
  const rows: EngineRow[] = [
    { id: 'r1', position: 0, active: true, values: { txt: 'RH' } },
    { id: 'r2', position: 1, active: true, values: { txt: 'QA', num: 50 } },
    { id: 'r3', position: 2, active: true, values: {} },
    { id: 'r4', position: 3, active: false, values: { txt: 'QA' } },
  ];
  const t: EngineTable = { key: 'resp', revision: 3, columns, rows };
  const q: LookupQuery = {
    table: 'resp',
    match: [{ column: 'txt', op: 'eq', source: { var: 'area' } }, { column: 'num', op: 'gte', source: { value: 10 } }],
  };

  it('lista las coincidencias, la primera y en qué condición falla cada fila', () => {
    const r = dryRun(t, q, { area: 'QA' });
    expect(r.revision).toBe(3);
    expect(r.matches.map((m) => m.rowId)).toEqual(['r3']);
    expect(r.first?.rowId).toBe('r3');
    expect(r.ignoredInactive).toBe(1);
    expect(r.truncated).toBe(false);
    expect(r.explain.map((e) => [e.rowId, e.matched, e.failedAt?.index])).toEqual([
      ['r1', false, 0],
      ['r2', false, 1],
      ['r3', true, undefined],
    ]);
    expect(r.explain[0]!.failedAt?.reason).toContain('no es igual a');
    expect(r.explain[1]!.failedAt?.reason).toContain('no es mayor o igual que');
  });
  it('sin coincidencias: first null', () => {
    const r = dryRun({ ...t, rows: rows.slice(0, 2) }, q, { area: 'Soporte' });
    expect(r.first).toBeNull();
    expect(r.matches).toEqual([]);
  });
  it('acota la explicación y las coincidencias en tablas grandes', () => {
    const many: EngineRow[] = Array.from({ length: 700 }, (_, i) => ({ id: `x${String(i).padStart(4, '0')}`, position: i, active: true, values: {} }));
    const r = dryRun({ ...t, rows: many }, q, { area: 'QA' });
    expect(r.explain).toHaveLength(500);
    expect(r.matches).toHaveLength(50);
    expect(r.first?.rowId).toBe('x0000');
    expect(r.truncated).toBe(true);
  });
});
