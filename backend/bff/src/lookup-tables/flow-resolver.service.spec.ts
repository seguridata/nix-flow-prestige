/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { Flow, LookupQuery } from '../flow/flow.types';
import { FlowResolverService, awaitingInputs } from './flow-resolver.service';
import { makeLookupDb } from './lookup-tables.fixtures';

const cols = [
  { key: 'etapa', label: 'Etapa', type: 'select', options: ['area', 'tipoGasto'] },
  { key: 'area', label: 'Área', type: 'text' },
  { key: 'tipoGasto', label: 'Tipo', type: 'text' },
  { key: 'montoMin', label: 'Desde', type: 'number' },
  { key: 'montoMax', label: 'Hasta', type: 'number' },
  { key: 'signerId', label: 'Responsable', type: 'text' },
  { key: 'nombre', label: 'Nombre', type: 'text' },
  { key: 'correo', label: 'Correo', type: 'text' },
];
const nivelCols = [
  { key: 'tipoGasto', label: 'Tipo', type: 'text' },
  { key: 'nivel', label: 'Nivel', type: 'number' },
];

const table = (id: string, tenantId: string, key: string, columns: any[], extra: Record<string, unknown> = {}) => ({ id, tenantId, key, name: key, columns, createdBy: 'x', ...extra });
const row = (tenantId: string, tableId: string, position: number, values: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: `${tableId}-${position}`, tenantId, tableId, position, values, ...extra });

const consulta = (etapa: 'area' | 'tipoGasto'): LookupQuery => ({
  table: 'responsables',
  match: [
    { column: 'etapa', op: 'eq', source: { value: etapa }, emptyMatchesAny: false },
    ...(etapa === 'area'
      ? [{ column: 'area', op: 'eq' as const, source: { var: 'area' } }]
      : [
          { column: 'tipoGasto', op: 'eq' as const, source: { var: 'tipoGasto' } },
          { column: 'montoMin', op: 'gte' as const, source: { var: 'monto' } },
          { column: 'montoMax', op: 'lte' as const, source: { var: 'monto' } },
        ]),
  ],
});
const person = { signerId: 'signerId', name: 'nombre', email: 'correo' };

const flow = (over: Partial<Flow> = {}): Flow => ({
  order: 'SECUENCIAL',
  slaHours: 48,
  variables: [
    { key: 'area', label: 'Área', type: 'text', required: true },
    { key: 'tipoGasto', label: 'Tipo', type: 'text', required: true },
    { key: 'monto', label: 'Monto', type: 'number', required: true },
  ],
  steps: [
    { id: 'sol', label: 'Solicitante', role: 'FIRMANTE', who: { type: 'initiator' } },
    { id: 'aut_area', label: 'Autoriza área', role: 'FIRMANTE', who: { type: 'lookup', query: consulta('area'), person, prompt: '¿Quién autoriza el área?' } },
    { id: 'aut_tipo', label: 'Autoriza gasto', role: 'FIRMANTE', who: { type: 'lookup', query: consulta('tipoGasto'), person, prompt: '¿Quién autoriza el gasto?' } },
  ],
  ...over,
});

const base = () => ({
  tables: [table('tA', 'acme', 'responsables', cols, { revision: 5 }), table('tB', 'beta', 'responsables', cols, { revision: 9 })],
  rows: [
    row('acme', 'tA', 0, { etapa: 'area', area: 'QA', signerId: 'jefe-qa', nombre: 'Jefe QA', correo: 'qa@x.mx' }),
    row('acme', 'tA', 1, { etapa: 'tipoGasto', tipoGasto: 'Viaje', montoMax: 10000, signerId: 'viaje-chico' }),
    row('acme', 'tA', 2, { etapa: 'tipoGasto', tipoGasto: 'Viaje', montoMin: 10000.01, signerId: 'viaje-grande', nombre: 'Dir Viajes' }),
    row('beta', 'tB', 0, { etapa: 'area', area: 'QA', signerId: 'jefe-de-beta' }),
  ],
});

function setup(seed = base()) {
  const db = makeLookupDb(seed);
  const audit = { append: vi.fn(async () => ({})) };
  const svc = new FlowResolverService(db as any, audit as any);
  return { svc, db, audit };
}
const loads = (db: any) => db.lookupTable.findMany.mock.calls.length;

describe('FlowResolverService.resolve', () => {
  const values = { area: 'qa', tipoGasto: 'Viaje', monto: 500 };

  it('resuelve cada paso lookup activo con la persona de su fila y deja la traza (sin valores)', async () => {
    const { svc } = setup();
    const r = await svc.resolve(flow(), values, 'acme');
    expect(r.picks.get('aut_area')).toEqual({ signerId: 'jefe-qa', name: 'Jefe QA', email: 'qa@x.mx' });
    expect(r.picks.get('aut_tipo')).toEqual({ signerId: 'viaje-chico', name: null, email: null });
    expect(r.picks.has('sol')).toBe(false);
    expect(r.steps).toEqual([
      { stepId: 'aut_area', table: 'responsables', revision: 5, rowId: 'tA-0' },
      { stepId: 'aut_tipo', table: 'responsables', revision: 5, rowId: 'tA-1' },
    ]);
    expect(r.derived).toEqual([]);
    expect(r.resolved.map((s) => s.active)).toEqual([true, true, true]);
  });

  it('el monto elige la fila del rango (extremos incluidos)', async () => {
    const { svc } = setup();
    const at = async (monto: number) => (await svc.resolve(flow(), { ...values, monto }, 'acme')).picks.get('aut_tipo')?.signerId;
    expect(await at(10000)).toBe('viaje-chico');
    expect(await at(10000.01)).toBe('viaje-grande');
  });

  it('UNA sola carga de tablas por solicitud aunque haya varias consultas y derivadas', async () => {
    const seed = base();
    seed.tables.push(table('tN', 'acme', 'niveles', nivelCols));
    seed.rows.push(row('acme', 'tN', 0, { tipoGasto: 'Viaje', nivel: 3 }));
    const { svc, db } = setup(seed);
    const f = flow({ derived: [{ key: 'nivel', label: 'Nivel', type: 'number', column: 'nivel', query: { table: 'niveles', match: [{ column: 'tipoGasto', op: 'eq', source: { var: 'tipoGasto' } }] } }] });
    await svc.resolve(f, values, 'acme');
    expect(loads(db)).toBe(1);
    expect(db.lookupTable.findMany.mock.calls[0]![0].where).toMatchObject({ tenantId: 'acme', active: true });
    expect(db.lookupTable.findMany.mock.calls[0]![0].where.key.in.sort()).toEqual(['niveles', 'responsables']);
  });

  it('sin consultas no toca la base; con un paso lookup inactivo y sin derivadas tampoco', async () => {
    const { svc, db } = setup();
    await svc.resolve(flow({ steps: [{ id: 'a', label: 'A', role: 'FIRMANTE', who: { type: 'initiator' } }] }), values, 'acme');
    const f = flow();
    f.steps[1]!.when = [{ variable: 'monto', op: '>', value: 1_000_000 }];
    f.steps[2]!.when = [{ variable: 'monto', op: '>', value: 1_000_000 }];
    const r = await svc.resolve(f, values, 'acme');
    expect(loads(db)).toBe(0);
    expect(r.steps).toEqual([]);
    expect(r.picks.size).toBe(0);
  });

  it('solo carga las tablas de los pasos que aplican (sin derivadas)', async () => {
    const seed = base();
    seed.tables.push(table('tN', 'acme', 'otra', nivelCols));
    const { svc, db } = setup(seed);
    const f = flow();
    f.steps[2] = { id: 'x', label: 'X', role: 'FIRMANTE', when: [{ variable: 'monto', op: '>', value: 1e9 }], who: { type: 'lookup', query: { table: 'otra', match: [{ column: 'tipoGasto', op: 'eq', source: { var: 'tipoGasto' } }] }, person, prompt: 'p' } };
    await svc.resolve(f, values, 'acme');
    expect(db.lookupTable.findMany.mock.calls[0]![0].where.key.in).toEqual(['responsables']);
  });

  it('sin coincidencia el paso queda sin persona (cae a «preguntar») y la traza lo marca con rowId null', async () => {
    const { svc } = setup();
    const r = await svc.resolve(flow(), { ...values, area: 'Soporte' }, 'acme');
    expect(r.picks.get('aut_area')).toBeNull();
    expect(r.picks.get('aut_tipo')?.signerId).toBe('viaje-chico');
    expect(r.steps[0]).toEqual({ stepId: 'aut_area', table: 'responsables', revision: 5, rowId: null });
  });

  it('valores a medio capturar no truenan: lo que falta queda sin resolver', async () => {
    const { svc } = setup();
    const r = await svc.resolve(flow(), {}, 'acme');
    expect([...r.picks.values()]).toEqual([null, null]);
  });

  describe('awaiting: entradas de la consulta aún sin datos', () => {
    it('sin datos: cada paso lookup activo espera sus variables obligatorias (con etiqueta del flujo) y no se consulta', async () => {
      const { svc } = setup();
      const r = await svc.resolve(flow(), {}, 'acme');
      expect(r.awaiting.get('aut_area')).toEqual([{ key: 'area', label: 'Área' }]);
      expect(r.awaiting.get('aut_tipo')).toEqual([
        { key: 'tipoGasto', label: 'Tipo' },
        { key: 'monto', label: 'Monto' },
      ]);
      expect(r.awaiting.has('sol')).toBe(false);
      expect(r.steps).toEqual([]); // no hubo consulta: tampoco traza
    });

    it('con los datos completos no espera nada; sin coincidencia es unresolved (picks null), no awaiting', async () => {
      const { svc } = setup();
      const ok = await svc.resolve(flow(), values, 'acme');
      expect(ok.awaiting.size).toBe(0);
      const miss = await svc.resolve(flow(), { ...values, area: 'Soporte' }, 'acme');
      expect(miss.awaiting.size).toBe(0);
      expect(miss.picks.get('aut_area')).toBeNull();
      expect(miss.steps[0]!.rowId).toBeNull();
    });

    it('espera solo lo que falta; lo vacío o en blanco cuenta como faltante', async () => {
      const { svc } = setup();
      const r = await svc.resolve(flow(), { area: 'QA', tipoGasto: '   ', monto: 500 }, 'acme');
      expect(r.awaiting.has('aut_area')).toBe(false);
      expect(r.picks.get('aut_area')?.signerId).toBe('jefe-qa');
      expect(r.awaiting.get('aut_tipo')).toEqual([{ key: 'tipoGasto', label: 'Tipo' }]);
    });

    it('una variable NO obligatoria vacía cuenta como entrada completa: consulta (y puede no coincidir) pero no espera', async () => {
      const { svc } = setup();
      const f = flow();
      f.variables = f.variables.map((v) => (v.key === 'area' ? { ...v, required: false } : v));
      const r = await svc.resolve(f, {}, 'acme');
      expect(r.awaiting.has('aut_area')).toBe(false);
      expect(r.picks.get('aut_area')).toBeNull();
      expect(r.steps[0]).toMatchObject({ stepId: 'aut_area', rowId: null });
    });

    it('un paso inactivo no espera nada; una derivada vacía (no obligatoria) tampoco bloquea', async () => {
      const { svc } = setup();
      const f = flow();
      f.steps[1]!.when = [{ variable: 'monto', op: '>', value: 1e9 }];
      expect((await svc.resolve(f, { monto: 1 }, 'acme')).awaiting.has('aut_area')).toBe(false);
      const g = flow({ derived: [{ key: 'nivel', label: 'Nivel', type: 'number', column: 'montoMin', query: { table: 'responsables', match: [{ column: 'area', op: 'eq', source: { var: 'area' } }] } }] });
      (g.steps[1]!.who as any).query.match.push({ column: 'montoMin', op: 'gte', source: { var: 'nivel' } });
      expect((await svc.resolve(g, { area: 'ZZ' }, 'acme')).awaiting.has('aut_area')).toBe(false);
    });

    it('awaitingInputs no repite variables, ignora fuentes fijas y no revela columnas ni tablas', () => {
      const q: LookupQuery = {
        table: 'secreta',
        match: [
          { column: 'colSecreta', op: 'eq', source: { var: 'area' } },
          { column: 'otra', op: 'eq', source: { var: 'area' } },
          { column: 'etapa', op: 'eq', source: { value: 'area' } },
          { column: 'vacia', op: 'isEmpty' },
        ],
      };
      const out = awaitingInputs(flow(), q, {});
      expect(out).toEqual([{ key: 'area', label: 'Área' }]);
      expect(JSON.stringify(out)).not.toMatch(/secreta|colSecreta|otra/);
    });
  });

  it('una fila coincidente sin responsable (celda vacía) no resuelve a nadie', async () => {
    const seed = base();
    seed.rows[0] = row('acme', 'tA', 0, { etapa: 'area', area: 'QA', nombre: 'Sin id' });
    const { svc } = setup(seed);
    const r = await svc.resolve(flow(), values, 'acme');
    expect(r.picks.get('aut_area')).toBeNull();
    expect(r.steps[0]!.rowId).toBeNull();
  });

  it('el tenant A no ve ni resuelve las filas del tenant B (y viceversa)', async () => {
    const { svc } = setup();
    const a = await svc.resolve(flow(), values, 'acme');
    const b = await svc.resolve(flow(), values, 'beta');
    expect(a.picks.get('aut_area')?.signerId).toBe('jefe-qa');
    expect(b.picks.get('aut_area')?.signerId).toBe('jefe-de-beta');
    expect(b.steps[0]!.revision).toBe(9);
    // un tenant sin la tabla: todo cae a preguntar, jamás a las filas de otro
    const c = await svc.resolve(flow(), values, 'gamma');
    expect([...c.picks.values()]).toEqual([null, null]);
    expect(c.steps.map((s) => [s.revision, s.rowId])).toEqual([[null, null], [null, null]]);
  });

  it('una tabla inactiva no se consulta', async () => {
    const seed = base();
    (seed.tables[0] as any).active = false;
    const { svc } = setup(seed);
    const r = await svc.resolve(flow(), values, 'acme');
    expect(r.picks.get('aut_area')).toBeNull();
    expect(r.steps[0]!.revision).toBeNull();
  });

  it('las filas inactivas se ignoran: la siguiente coincidente gana', async () => {
    const seed = base();
    (seed.rows[0] as any).active = false;
    seed.rows.splice(1, 0, row('acme', 'tA', 5, { etapa: 'area', area: 'QA', signerId: 'suplente' }));
    const { svc } = setup(seed);
    expect((await svc.resolve(flow(), values, 'acme')).picks.get('aut_area')?.signerId).toBe('suplente');
  });

  describe('variables derivadas', () => {
    const seed = () => {
      const s = base();
      s.tables.push(table('tN', 'acme', 'niveles', nivelCols, { revision: 2 }), table('tNB', 'beta', 'niveles', nivelCols, { revision: 2 }));
      s.rows.push(row('acme', 'tN', 0, { tipoGasto: 'Viaje', nivel: 3 }), row('beta', 'tNB', 0, { tipoGasto: 'Viaje', nivel: 99 }));
      return s;
    };
    const derived = (onMiss?: 'empty' | 'fail') => ({ key: 'nivel', label: 'Nivel', type: 'number' as const, column: 'nivel', ...(onMiss ? { onMiss } : {}), query: { table: 'niveles', match: [{ column: 'tipoGasto', op: 'eq' as const, source: { var: 'tipoGasto' } }] } });
    const conNivel = (onMiss?: 'empty' | 'fail') => {
      const f = flow({ derived: [derived(onMiss)] });
      f.steps[1]!.when = [{ variable: 'nivel', op: '>=', value: 3 }]; // la derivada decide si el paso aplica
      return f;
    };

    it('se calculan ANTES de decidir qué pasos aplican y alimentan `when`', async () => {
      const { svc } = setup(seed());
      const r = await svc.resolve(conNivel(), values, 'acme');
      expect(r.values.nivel).toBe(3);
      expect(r.derived).toEqual([{ key: 'nivel', table: 'niveles', revision: 2, rowId: 'tN-0' }]);
      expect(r.resolved.find((s) => s.step.id === 'aut_area')!.active).toBe(true);
      expect(r.picks.get('aut_area')?.signerId).toBe('jefe-qa');
      const sin = await svc.resolve(conNivel(), { ...values, tipoGasto: 'Marketing' }, 'acme');
      expect(sin.values.nivel).toBeUndefined();
      expect(sin.resolved.find((s) => s.step.id === 'aut_area')!.active).toBe(false);
      expect(sin.picks.has('aut_area')).toBe(false); // un paso inactivo no se resuelve
    });

    it('lo que el usuario mande con la clave de una derivada no cuenta', async () => {
      const { svc } = setup(seed());
      const r = await svc.resolve(conNivel(), { ...values, tipoGasto: 'Marketing', nivel: 99 }, 'acme');
      expect(r.values.nivel).toBeUndefined();
      expect(r.resolved.find((s) => s.step.id === 'aut_area')!.active).toBe(false);
    });

    it('otro tenant no aporta su nivel', async () => {
      const { svc } = setup(seed());
      expect((await svc.resolve(conNivel(), values, 'acme')).values.nivel).toBe(3);
      expect((await svc.resolve(conNivel(), values, 'beta')).values.nivel).toBe(99);
      expect((await svc.resolve(conNivel(), values, 'gamma')).values.nivel).toBeUndefined();
    });

    it("onMiss 'fail': al instanciar (strict) responde 400; en la vista previa solo queda vacía", async () => {
      const { svc } = setup(seed());
      const miss = { ...values, tipoGasto: 'Marketing' };
      const err: any = await svc.resolve(conNivel('fail'), miss, 'acme', { strict: true }).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toContain('Nivel');
      const soft = await svc.resolve(conNivel('fail'), miss, 'acme');
      expect(soft.values.nivel).toBeUndefined();
      // con coincidencia, strict no estorba
      await expect(svc.resolve(conNivel('fail'), values, 'acme', { strict: true })).resolves.toBeTruthy();
    });

    it("onMiss 'empty' (por defecto) no falla ni siquiera en strict", async () => {
      const { svc } = setup(seed());
      await expect(svc.resolve(conNivel(), { ...values, tipoGasto: 'Marketing' }, 'acme', { strict: true })).resolves.toBeTruthy();
    });
  });
});

describe('FlowResolverService.assertTables', () => {
  it('sin consultas no toca la base', async () => {
    const { svc, db } = setup();
    await svc.assertTables(flow({ steps: [{ id: 'a', label: 'A', role: 'FIRMANTE', who: { type: 'initiator' } }] }), 'acme');
    expect(loads(db)).toBe(0);
  });

  it('acepta un flujo cuyas tablas existen, están activas y cuadran', async () => {
    const { svc } = setup();
    await expect(svc.assertTables(flow(), 'acme')).resolves.toBeUndefined();
  });

  const errorsOf = async (svc: FlowResolverService, f: Flow, tenant = 'acme') => {
    const err: any = await svc.assertTables(f, tenant).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    return (err.getResponse().errors as string[]).join(' | ');
  };

  it('la tabla debe existir en EL TENANT (la de otro tenant no cuenta)', async () => {
    const { svc } = setup();
    expect(await errorsOf(svc, flow(), 'gamma')).toContain('no existe o no está activa');
    const seed = base();
    seed.tables = [seed.tables[1]!]; // solo la de beta
    expect(await errorsOf(setup(seed).svc, flow())).toContain('«responsables», que no existe');
  });

  it('la tabla debe estar activa', async () => {
    const seed = base();
    (seed.tables[0] as any).active = false;
    expect(await errorsOf(setup(seed).svc, flow())).toContain('no existe o no está activa');
  });

  it('las columnas citadas deben existir y el operador tener sentido para su tipo', async () => {
    const { svc } = setup();
    const f = flow();
    (f.steps[1]!.who as any).query.match[1].column = 'noexiste';
    expect(await errorsOf(svc, f)).toContain('la columna «noexiste» no existe en la tabla');
    const g = flow();
    (g.steps[1]!.who as any).query.match[1] = { column: 'area', op: 'gt', source: { var: 'area' } };
    expect(await errorsOf(svc, g)).toContain('no aplica a la columna «area»');
    const h = flow();
    (h.steps[1]!.who as any).person = { signerId: 'quien' };
    expect(await errorsOf(svc, h)).toContain('toma datos de la columna «quien»');
  });

  it('una variable de texto no se compara con una columna numérica', async () => {
    const { svc } = setup();
    const f = flow();
    (f.steps[2]!.who as any).query.match[2] = { column: 'montoMin', op: 'gte', source: { var: 'area' } };
    expect(await errorsOf(svc, f)).toContain('«area» es de tipo text y la columna «montoMin» de tipo number');
  });

  it('valida también las variables derivadas', async () => {
    const { svc } = setup();
    const f = flow({ derived: [{ key: 'n', label: 'N', type: 'number', column: 'nivel', query: { table: 'niveles', match: [{ column: 'tipoGasto', op: 'eq', source: { var: 'tipoGasto' } }] } }] });
    expect(await errorsOf(svc, f)).toContain('variable derivada «n» usa la tabla «niveles»');
  });
});

describe('FlowResolverService.recordResolved (LOOKUP_RESOLVED)', () => {
  it('registra tenant, actor, formato, solicitud y por paso {stepId, table, revision, rowId}; nada personal', async () => {
    const { svc, audit } = setup();
    const resolution = await svc.resolve(flow(), { area: 'QA', tipoGasto: 'Viaje', monto: 1 }, 'acme');
    await svc.recordResolved({ tenantId: 'acme', actorId: 'maria', templateId: 'tpl1', requestId: 'sr1', documentId: 'd1', resolution });
    expect(audit.append).toHaveBeenCalledTimes(1);
    const ev = (audit.append.mock.calls[0] as any[])[0];
    expect(ev).toMatchObject({ tenantId: 'acme', actorId: 'maria', action: 'LOOKUP_RESOLVED', signatureRequestId: 'sr1', documentId: 'd1' });
    expect(ev.payload).toEqual({
      tenantId: 'acme',
      actorId: 'maria',
      templateId: 'tpl1',
      requestId: 'sr1',
      steps: [
        { stepId: 'aut_area', table: 'responsables', revision: 5, rowId: 'tA-0' },
        { stepId: 'aut_tipo', table: 'responsables', revision: 5, rowId: 'tA-1' },
      ],
      derived: [],
    });
    const json = JSON.stringify(ev);
    for (const pii of ['jefe-qa', 'Jefe QA', 'qa@x.mx', 'viaje-chico']) expect(json).not.toContain(pii);
  });

  it('un paso sin coincidencia se registra con rowId null', async () => {
    const { svc, audit } = setup();
    const resolution = await svc.resolve(flow(), { area: 'Nada', tipoGasto: 'Viaje', monto: 1 }, 'acme');
    await svc.recordResolved({ tenantId: 'acme', actorId: 'm', templateId: 't', requestId: 'r', resolution });
    expect(((audit.append.mock.calls[0] as any[])[0].payload.steps as any[])[0]).toEqual({ stepId: 'aut_area', table: 'responsables', revision: 5, rowId: null });
  });

  it('sin consultas no hay evento; si la cadena falla, no deshace nada', async () => {
    const { svc, audit } = setup();
    await svc.recordResolved({ tenantId: 'acme', actorId: 'm', templateId: 't', requestId: 'r', resolution: { steps: [], derived: [] } });
    expect(audit.append).not.toHaveBeenCalled();
    audit.append.mockRejectedValueOnce(new Error('cadena caída'));
    const resolution = await svc.resolve(flow(), { area: 'QA', tipoGasto: 'Viaje', monto: 1 }, 'acme');
    await expect(svc.recordResolved({ tenantId: 'acme', actorId: 'm', templateId: 't', requestId: 'r', resolution })).resolves.toBeUndefined();
  });
});
