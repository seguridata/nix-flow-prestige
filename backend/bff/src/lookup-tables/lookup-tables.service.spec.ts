/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/roles.decorator';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { LookupTablesController } from './lookup-tables.controller';
import { LookupTablesService, type LookupActor } from './lookup-tables.service';
import { MAX_ROWS } from './lookup-validation';
import { columnsFixture, makeLookupDb } from './lookup-tables.fixtures';

const A: LookupActor = { tenantId: 'acme', actorId: 'ana', name: 'Ana' };
const B: LookupActor = { tenantId: 'beta', actorId: 'beto', name: 'Beto' };

const tableA = { id: 'tA', tenantId: 'acme', key: 'responsables-gasto', name: 'Responsables', columns: columnsFixture, createdBy: 'ana' };
const tableB = { id: 'tB', tenantId: 'beta', key: 'responsables-gasto', name: 'Responsables B', columns: columnsFixture, createdBy: 'beto' };
const rowOf = (tenantId: string, tableId: string, i: number, values: Record<string, unknown> = {}) => ({ id: `${tableId}-r${i}`, tenantId, tableId, position: i, values: { etapa: 'area', signerId: `s${i}`, ...values } });

function setup(seed: Parameters<typeof makeLookupDb>[0] = {}) {
  const db = makeLookupDb({ tables: [tableA, tableB], ...seed });
  const audit = { append: vi.fn(async () => ({})) };
  const svc = new LookupTablesService(db as any, audit as any);
  return { svc, db, audit };
}

const catchErr = async (p: Promise<unknown>) => p.then(() => undefined, (e) => e);
const events = (audit: { append: { mock: { calls: any[][] } } }) => audit.append.mock.calls.map((c) => c[0]);

describe('roles y forma del controlador', () => {
  it('TODAS las rutas son solo para admin y no hay rutas @Public', () => {
    const proto = LookupTablesController.prototype as any;
    const names = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(names.length).toBeGreaterThanOrEqual(11);
    for (const n of names) expect(Reflect.getMetadata(ROLES_KEY, proto[n]), n).toEqual(['admin']);
    for (const n of names) expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto[n]), n).toBeUndefined();
  });

  it('las rutas fijas de filas se declaran antes que rows/:rowId', () => {
    const names = Object.getOwnPropertyNames(LookupTablesController.prototype);
    expect(names.indexOf('reorder')).toBeLessThan(names.indexOf('updateRow'));
    expect(names.indexOf('import')).toBeLessThan(names.indexOf('updateRow'));
  });
});

describe('crear y editar tablas', () => {
  const body = { key: 'niveles', name: 'Niveles', description: 'Niveles de aprobación', columns: [{ key: 'tipo', label: 'Tipo', type: 'text' }, { key: 'nivel', label: 'Nivel', type: 'number' }] };

  it('crea la tabla en el tenant del actor y la audita sin valores', async () => {
    const { svc, db, audit } = setup();
    const out = await svc.create(body, A);
    expect(out).toMatchObject({ key: 'niveles', name: 'Niveles', revision: 1, active: true, rowCount: 0 });
    expect(db.state.tables.find((t: any) => t.key === 'niveles')).toMatchObject({ tenantId: 'acme', createdBy: 'ana' });
    const [e] = events(audit);
    expect(e).toMatchObject({ tenantId: 'acme', actorId: 'ana', action: 'LOOKUP_TABLE_CREATED' });
    expect(e.payload).toMatchObject({ key: 'niveles', columnKeys: ['tipo', 'nivel'], revision: 1 });
  });

  it('la misma clave puede existir en dos tenants, pero no dos veces en uno (409)', async () => {
    const { svc } = setup();
    await expect(svc.create({ ...body, key: 'responsables-gasto' }, B)).rejects.toBeInstanceOf(ConflictException);
    const { svc: svc2 } = setup({ tables: [] });
    await svc2.create(body, A);
    await svc2.create(body, B);
    expect(await catchErr(svc2.create(body, A))).toBeInstanceOf(ConflictException);
  });

  it.each([
    ['clave con mayúsculas', { key: 'Mi Tabla' }, 'clave de la tabla'],
    ['clave vacía', { key: '' }, 'clave de la tabla'],
    ['sin nombre', { name: ' ' }, 'Nombre'],
    ['nombre larguísimo', { name: 'x'.repeat(121) }, 'máximo 120'],
    ['descripción larguísima', { description: 'x'.repeat(501) }, 'máximo 500'],
    ['sin columnas', { columns: [] }, 'al menos una columna'],
    ['más de 30 columnas', { columns: Array.from({ length: 31 }, (_, i) => ({ key: `c${i}`, label: 'C', type: 'text' })) }, 'Máximo 30 columnas'],
    ['clave de columna inválida', { columns: [{ key: '1a', label: 'X', type: 'text' }] }, 'debe empezar con letra'],
    ['clave de columna repetida', { columns: [{ key: 'a', label: 'X', type: 'text' }, { key: 'a', label: 'Y', type: 'text' }] }, 'repetida'],
    ['tipo de columna inválido', { columns: [{ key: 'a', label: 'X', type: 'boolean' }] }, 'el tipo debe ser'],
    ['columna sin etiqueta', { columns: [{ key: 'a', type: 'text' }] }, 'etiqueta'],
    ['select sin opciones', { columns: [{ key: 'a', label: 'X', type: 'select' }] }, 'necesita de 1 a'],
    ['select con opción vacía', { columns: [{ key: 'a', label: 'X', type: 'select', options: ['ok', ' '] }] }, 'necesita de 1 a'],
    ['opciones en una columna de texto', { columns: [{ key: 'a', label: 'X', type: 'text', options: ['x'] }] }, 'solo las columnas de selección'],
  ])('rechaza %s con 400', async (_n, over, msg) => {
    const { svc, db } = setup({ tables: [] });
    const err: any = await catchErr(svc.create({ ...body, ...over }, A));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toContain(msg);
    expect(db.state.tables).toHaveLength(0);
  });

  it('acepta 30 columnas y deduplica opciones de select', async () => {
    const { svc } = setup({ tables: [] });
    const cols = Array.from({ length: 30 }, (_, i) => ({ key: `c${i}`, label: `C${i}`, type: 'text' }));
    cols[0] = { key: 'c0', label: 'C0', type: 'select', options: ['a', 'a ', 'b'] } as any;
    const out = await svc.create({ ...body, columns: cols }, A);
    expect(out.columns).toHaveLength(30);
    expect(out.columns[0]!.options).toEqual(['a', 'b']);
  });

  it('editar nombre o activo NO sube la revisión; editar columnas sí', async () => {
    const { svc, audit } = setup();
    const r1 = await svc.update('tA', { name: 'Nuevo nombre', active: false }, A);
    expect(r1).toMatchObject({ name: 'Nuevo nombre', active: false, revision: 1 });
    const r2 = await svc.update('tA', { columns: [...columnsFixture, { key: 'extra', label: 'Extra', type: 'text' }] }, A);
    expect(r2.revision).toBe(2);
    expect(r2.columns.map((c) => c.key)).toContain('extra');
    expect(events(audit).map((e) => e.action)).toEqual(['LOOKUP_TABLE_UPDATED', 'LOOKUP_TABLE_UPDATED']);
    expect(events(audit)[0].payload.changed).toEqual(['name', 'active']);
    expect(events(audit)[1].payload).toMatchObject({ changed: ['columns'], revision: 2 });
  });

  it('una edición sin cambios no escribe ni audita', async () => {
    const { svc, audit } = setup();
    await svc.update('tA', { name: 'Responsables', columns: columnsFixture }, A);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('quitar una columna la limpia de las filas y sube la revisión', async () => {
    const { svc, db } = setup({ rows: [rowOf('acme', 'tA', 0, { nombre: 'Ana López' })] });
    const cols = columnsFixture.filter((c) => c.key !== 'nombre');
    const out = await svc.update('tA', { columns: cols }, A);
    expect(out.revision).toBe(2);
    expect(db.state.rows[0].values).not.toHaveProperty('nombre');
    expect(db.state.rows[0].values.signerId).toBe('s0');
  });

  it('cambiar el tipo de una columna con valores que ya no valen → 400 y nada cambia', async () => {
    const { svc, db } = setup({ rows: [rowOf('acme', 'tA', 0, { area: 'Comercial' })] });
    const cols = columnsFixture.map((c) => (c.key === 'area' ? { key: 'area', label: 'Área', type: 'number' } : c));
    const err: any = await catchErr(svc.update('tA', { columns: cols }, A));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(db.state.tables.find((t: any) => t.id === 'tA').revision).toBe(1);
  });

  it('quitar una columna que cita un formato del tenant → 409 con el formato', async () => {
    const flow = { steps: [{ id: 's', who: { type: 'lookup', query: { table: 'responsables-gasto', match: [{ column: 'area', op: 'eq', source: { var: 'a' } }] }, person: { signerId: 'signerId' } } }] };
    const { svc } = setup({ templates: [{ id: 'f1', tenantId: 'acme', name: 'Adquisiciones', flow }] });
    const err: any = await catchErr(svc.update('tA', { columns: columnsFixture.filter((c) => c.key !== 'area') }, A));
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ columns: ['area'], templates: [{ id: 'f1', name: 'Adquisiciones' }] });
  });

  it('rechaza un cuerpo de edición inválido', async () => {
    const { svc } = setup();
    expect(await catchErr(svc.update('tA', { active: 'sí' }, A))).toBeInstanceOf(BadRequestException);
    expect(await catchErr(svc.update('tA', { columns: [] }, A))).toBeInstanceOf(BadRequestException);
    expect(await catchErr(svc.update('tA', { name: '' }, A))).toBeInstanceOf(BadRequestException);
  });
});

describe('aislamiento por tenant', () => {
  const seed = { rows: [rowOf('acme', 'tA', 0, { area: 'QA' }), rowOf('beta', 'tB', 0, { area: 'QA' })] };

  it('el listado solo trae las tablas del tenant (con su conteo de filas)', async () => {
    const { svc } = setup(seed);
    const a = await svc.list('acme');
    expect(a.map((t) => [t.id, t.rowCount])).toEqual([['tA', 1]]);
    expect((await svc.list('beta')).map((t) => t.id)).toEqual(['tB']);
    expect(await svc.list('otro')).toEqual([]);
  });

  it('con el id de una tabla ajena TODA operación responde 404 y no toca nada', async () => {
    const { svc, db, audit } = setup(seed);
    const rowB = 'tB-r0';
    const calls: [string, Promise<unknown>][] = [
      ['get', svc.get('tB', 'acme')],
      ['update', svc.update('tB', { name: 'Robada' }, A)],
      ['remove', svc.remove('tB', A)],
      ['listRows', svc.listRows('tB', {}, 'acme')],
      ['createRow', svc.createRow('tB', { values: { signerId: 'x' } }, A)],
      ['updateRow', svc.updateRow('tB', rowB, { active: false }, A)],
      ['removeRow', svc.removeRow('tB', rowB, A)],
      ['reorder', svc.reorder('tB', [rowB], A)],
      ['import', svc.importRows('tB', [{ signerId: 'x' }], true, A)],
      ['test', svc.test('tB', { table: 'responsables-gasto', match: [{ column: 'area', op: 'eq', source: { value: 'QA' } }] }, {}, 'acme')],
    ];
    for (const [name, p] of calls) expect(await catchErr(p), name).toBeInstanceOf(NotFoundException);
    expect(db.state.tables.find((t: any) => t.id === 'tB')).toMatchObject({ name: 'Responsables B', revision: 1 });
    expect(db.state.rows.filter((r: any) => r.tenantId === 'beta')).toHaveLength(1);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('una fila de otro tenant no se puede tocar ni siquiera usando el id de MI tabla', async () => {
    const { svc, db } = setup(seed);
    expect(await catchErr(svc.updateRow('tA', 'tB-r0', { active: false }, A))).toBeInstanceOf(NotFoundException);
    expect(await catchErr(svc.removeRow('tA', 'tB-r0', A))).toBeInstanceOf(NotFoundException);
    expect(db.state.rows.find((r: any) => r.id === 'tB-r0')).toMatchObject({ active: true });
  });

  it('importar con replace solo borra las filas de la tabla del tenant', async () => {
    const { svc, db } = setup(seed);
    const out = await svc.importRows('tA', [{ etapa: 'area', signerId: 'nuevo' }], true, A);
    expect(out).toMatchObject({ imported: 1, deleted: 1 });
    expect(db.state.rows.filter((r: any) => r.tenantId === 'beta')).toHaveLength(1);
    expect(db.state.rows.filter((r: any) => r.tenantId === 'acme').map((r: any) => r.values.signerId)).toEqual(['nuevo']);
  });

  it('reordenar con ids de otro tenant → 400 y no cambia posiciones', async () => {
    const { svc, db } = setup({ rows: [rowOf('acme', 'tA', 0), rowOf('acme', 'tA', 1), rowOf('beta', 'tB', 0)] });
    const err: any = await catchErr(svc.reorder('tA', ['tA-r1', 'tB-r0'], A));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(db.state.rows.map((r: any) => r.position)).toEqual([0, 1, 0]);
  });

  it('el dry-run no ve las filas del otro tenant', async () => {
    const { svc } = setup(seed);
    const q = { table: 'responsables-gasto', match: [{ column: 'area', op: 'eq', source: { value: 'QA' } }] };
    const out = await svc.test('tA', q, {}, 'acme');
    expect(out.matches.map((m) => m.rowId)).toEqual(['tA-r0']);
  });
});

describe('filas', () => {
  it('alta: valida por tipo, omite celdas vacías, asigna posición al final y sube la revisión', async () => {
    const { svc, db, audit } = setup();
    const r0 = await svc.createRow('tA', { values: { etapa: 'area', area: ' QA ', montoMin: '1500.50', vigencia: '2026-12-31', signerId: 'u1', nombre: '', correo: null } }, A);
    expect(r0.values).toEqual({ etapa: 'area', area: 'QA', montoMin: 1500.5, vigencia: '2026-12-31', signerId: 'u1' });
    expect(r0).toMatchObject({ position: 0, active: true });
    const r1 = await svc.createRow('tA', { values: { signerId: 'u2' } }, A);
    expect(r1.position).toBe(1);
    expect(db.state.tables.find((t: any) => t.id === 'tA').revision).toBe(3);
    expect(db.state.rows.every((r: any) => r.tenantId === 'acme' && r.tableId === 'tA')).toBe(true);
    expect(events(audit).map((e) => e.action)).toEqual(['LOOKUP_ROW_CREATED', 'LOOKUP_ROW_CREATED']);
  });

  it.each([
    ['columna inexistente', { nope: 'x' }, 'no existe en la tabla'],
    ['número inválido', { montoMin: 'mucho' }, 'debe ser un número'],
    ['número fuera de rango', { montoMin: 1e14 }, 'debe ser un número'],
    ['fecha inválida', { vigencia: '31/12/2026' }, 'AAAA-MM-DD'],
    ['fecha imposible', { vigencia: '2026-02-30' }, 'AAAA-MM-DD'],
    ['select fuera de lista', { etapa: 'otra' }, 'elige una de las opciones'],
    ['texto que no es texto', { area: { a: 1 } }, 'debe ser texto'],
    ['texto larguísimo', { area: 'x'.repeat(501) }, 'máximo 500'],
  ])('rechaza %s con 400 y no escribe', async (_n, values, msg) => {
    const { svc, db } = setup();
    const err: any = await catchErr(svc.createRow('tA', { values }, A));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toContain(msg);
    expect(db.state.rows).toHaveLength(0);
  });

  it('rechaza valores que no son un objeto', async () => {
    const { svc } = setup();
    expect(await catchErr(svc.createRow('tA', { values: [1] }, A))).toBeInstanceOf(BadRequestException);
    expect(await catchErr(svc.createRow('tA', {}, A))).toBeInstanceOf(BadRequestException);
  });

  it('tope de 5000 filas por tabla', async () => {
    const rows = Array.from({ length: MAX_ROWS }, (_, i) => rowOf('acme', 'tA', i));
    const { svc } = setup({ rows });
    const err: any = await catchErr(svc.createRow('tA', { values: { signerId: 'u' } }, A));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toContain('5000');
  });

  it('edición: `values` reemplaza la fila; sin cambios no sube la revisión; activo sí', async () => {
    const { svc, db, audit } = setup({ rows: [rowOf('acme', 'tA', 0, { area: 'QA', correo: 'a@x.mx' })] });
    const same = await svc.updateRow('tA', 'tA-r0', { values: { etapa: 'area', signerId: 's0', area: 'QA', correo: 'a@x.mx' } }, A);
    expect(same.values.area).toBe('QA');
    expect(db.state.tables.find((t: any) => t.id === 'tA').revision).toBe(1);
    expect(audit.append).not.toHaveBeenCalled();

    const out = await svc.updateRow('tA', 'tA-r0', { values: { etapa: 'area', signerId: 's9' } }, A);
    expect(out.values).toEqual({ etapa: 'area', signerId: 's9' }); // area y correo quedan vacíos = «cualquiera»
    expect(db.state.tables.find((t: any) => t.id === 'tA').revision).toBe(2);
    expect(events(audit)[0].payload.changedColumns.sort()).toEqual(['area', 'correo', 'signerId']);

    const off = await svc.updateRow('tA', 'tA-r0', { active: false }, A);
    expect(off.active).toBe(false);
    expect(db.state.tables.find((t: any) => t.id === 'tA').revision).toBe(3);
    expect(await catchErr(svc.updateRow('tA', 'tA-r0', { active: 'no' }, A))).toBeInstanceOf(BadRequestException);
    expect(await catchErr(svc.updateRow('tA', 'no-existe', { active: true }, A))).toBeInstanceOf(NotFoundException);
  });

  it('baja: borra la fila, sube la revisión y audita ids', async () => {
    const { svc, db, audit } = setup({ rows: [rowOf('acme', 'tA', 0)] });
    await svc.removeRow('tA', 'tA-r0', A);
    expect(db.state.rows).toHaveLength(0);
    expect(db.state.tables.find((t: any) => t.id === 'tA').revision).toBe(2);
    expect(events(audit)[0]).toMatchObject({ action: 'LOOKUP_ROW_DELETED', payload: { tableId: 'tA', rowId: 'tA-r0', revision: 2 } });
    expect(await catchErr(svc.removeRow('tA', 'tA-r0', A))).toBeInstanceOf(NotFoundException);
  });

  describe('listado por cursor', () => {
    const rows = Array.from({ length: 5 }, (_, i) => rowOf('acme', 'tA', i, { area: i === 3 ? 'Nómina' : 'Otra' }));

    it('pagina en orden de evaluación (position) con nextCursor hasta null', async () => {
      const { svc } = setup({ rows: [...rows].reverse() });
      const p1 = await svc.listRows('tA', { limit: 2 }, 'acme');
      expect(p1.items.map((r) => r.position)).toEqual([0, 1]);
      expect(p1.nextCursor).toBe('tA-r1');
      const p2 = await svc.listRows('tA', { limit: 2, cursor: p1.nextCursor! }, 'acme');
      expect(p2.items.map((r) => r.position)).toEqual([2, 3]);
      const p3 = await svc.listRows('tA', { limit: 2, cursor: p2.nextCursor! }, 'acme');
      expect(p3.items.map((r) => r.position)).toEqual([4]);
      expect(p3.nextCursor).toBeNull();
    });

    it('`q` filtra sin distinguir mayúsculas ni acentos y también pagina', async () => {
      const { svc } = setup({ rows });
      const r = await svc.listRows('tA', { q: 'NOMINA' }, 'acme');
      expect(r.items.map((x) => x.id)).toEqual(['tA-r3']);
      const all = await svc.listRows('tA', { q: 'otra', limit: 3 }, 'acme');
      expect(all.items).toHaveLength(3);
      const rest = await svc.listRows('tA', { q: 'otra', limit: 3, cursor: all.nextCursor! }, 'acme');
      expect(rest.items).toHaveLength(1);
      expect(rest.nextCursor).toBeNull();
    });

    it('el límite por defecto es 50 y el máximo 200', async () => {
      const big = Array.from({ length: 260 }, (_, i) => rowOf('acme', 'tA', i));
      const { svc } = setup({ rows: big });
      expect((await svc.listRows('tA', {}, 'acme')).items).toHaveLength(50);
      expect((await svc.listRows('tA', { limit: 9999 }, 'acme')).items).toHaveLength(200);
    });
  });
});

describe('reordenar', () => {
  const rows = [0, 1, 2, 3].map((i) => rowOf('acme', 'tA', i));

  it('los ids dados van primero y en ese orden; el resto sigue; posiciones 0..n-1', async () => {
    const { svc, db, audit } = setup({ rows });
    const out = await svc.reorder('tA', ['tA-r3', 'tA-r1'], A);
    expect(out).toEqual({ reordered: 4, revision: 2 });
    const order = [...db.state.rows].sort((a: any, b: any) => a.position - b.position).map((r: any) => r.id);
    expect(order).toEqual(['tA-r3', 'tA-r1', 'tA-r0', 'tA-r2']);
    expect(events(audit)[0]).toMatchObject({ action: 'LOOKUP_ROWS_REORDERED', payload: { tableId: 'tA', count: 4, revision: 2 } });
  });

  it('rechaza listas vacías, repetidas, con ids ajenos o demasiado largas', async () => {
    const { svc, db } = setup({ rows });
    for (const ids of [[], ['tA-r0', 'tA-r0'], ['no-existe'], [1], 'x', null] as any[]) {
      expect(await catchErr(svc.reorder('tA', ids, A)), JSON.stringify(ids)).toBeInstanceOf(BadRequestException);
    }
    expect(await catchErr(svc.reorder('tA', Array.from({ length: MAX_ROWS + 1 }, (_, i) => `x${i}`), A))).toBeInstanceOf(BadRequestException);
    expect(db.state.rows.map((r: any) => r.position)).toEqual([0, 1, 2, 3]);
  });
});

describe('importar', () => {
  it('todo o nada: una fila inválida aborta sin escribir y lista los errores con su número de fila', async () => {
    const { svc, db } = setup({ rows: [rowOf('acme', 'tA', 0)] });
    const err: any = await catchErr(svc.importRows('tA', [{ signerId: 'ok' }, { signerId: 'ok2', montoMin: 'x' }, { nope: 1 }], true, A));
    expect(err).toBeInstanceOf(BadRequestException);
    const errors = err.getResponse().errors as string[];
    expect(errors.some((e) => e.startsWith('Fila 2'))).toBe(true);
    expect(errors.some((e) => e.startsWith('Fila 3'))).toBe(true);
    expect(db.state.rows).toHaveLength(1); // ni siquiera borró por `replace`
    expect(db.state.tables.find((t: any) => t.id === 'tA').revision).toBe(1);
  });

  it('máximo 5000 filas por importación; vacío no vale', async () => {
    const { svc, db } = setup();
    expect(await catchErr(svc.importRows('tA', Array.from({ length: MAX_ROWS + 1 }, () => ({ signerId: 'x' })), false, A))).toBeInstanceOf(BadRequestException);
    expect(await catchErr(svc.importRows('tA', [], false, A))).toBeInstanceOf(BadRequestException);
    expect(await catchErr(svc.importRows('tA', 'x' as any, false, A))).toBeInstanceOf(BadRequestException);
    expect(db.state.rows).toHaveLength(0);
  });

  it('acepta exactamente 5000 filas', async () => {
    const { svc, db } = setup();
    const out = await svc.importRows('tA', Array.from({ length: MAX_ROWS }, (_, i) => ({ signerId: `u${i}` })), false, A);
    expect(out.imported).toBe(MAX_ROWS);
    expect(db.state.rows).toHaveLength(MAX_ROWS);
  });

  it('sin replace agrega al final y respeta el tope total', async () => {
    const { svc, db } = setup({ rows: [rowOf('acme', 'tA', 0), rowOf('acme', 'tA', 1)] });
    const out = await svc.importRows('tA', [{ signerId: 'n1' }, { signerId: 'n2' }], false, A);
    expect(out).toMatchObject({ imported: 2, deleted: 0, revision: 2 });
    expect(db.state.rows.map((r: any) => r.position)).toEqual([0, 1, 2, 3]);
    const full = setup({ rows: Array.from({ length: MAX_ROWS - 1 }, (_, i) => rowOf('acme', 'tA', i)) });
    expect(await catchErr(full.svc.importRows('tA', [{ signerId: 'a' }, { signerId: 'b' }], false, A))).toBeInstanceOf(BadRequestException);
  });

  it('con replace renumera desde 0, sube UNA sola vez la revisión y audita conteos', async () => {
    const { svc, db, audit } = setup({ rows: [rowOf('acme', 'tA', 0), rowOf('acme', 'tA', 1)] });
    const out = await svc.importRows('tA', [{ signerId: 'n1' }, { signerId: 'n2' }, { signerId: 'n3' }], true, A);
    expect(out).toEqual({ imported: 3, deleted: 2, revision: 2 });
    expect(db.state.rows.map((r: any) => r.position)).toEqual([0, 1, 2]);
    expect(events(audit)[0]).toMatchObject({ action: 'LOOKUP_ROWS_IMPORTED', payload: { count: 3, replace: true, deleted: 2, revision: 2 } });
  });
});

describe('borrar una tabla', () => {
  const usesTable = (key: string) => ({
    steps: [{ id: 's1', who: { type: 'lookup', query: { table: key, match: [{ column: 'area', op: 'eq', source: { var: 'a' } }] }, person: { signerId: 'signerId' } } }],
  });
  const derivedUses = (key: string) => ({ steps: [{ id: 's1', who: { type: 'initiator' } }], derived: [{ key: 'n', label: 'N', type: 'number', column: 'nivel', query: { table: key, match: [] } }] });

  it('409 con la lista de formatos y definiciones del tenant que la usan (y no borra)', async () => {
    const { svc, db, audit } = setup({
      rows: [rowOf('acme', 'tA', 0)],
      templates: [
        { id: 'f1', tenantId: 'acme', name: 'Adquisiciones', flow: usesTable('responsables-gasto') },
        { id: 'f2', tenantId: 'acme', name: 'Otro formato', flow: usesTable('otra-tabla') },
        { id: 'f3', tenantId: 'acme', name: 'Con derivada', flow: derivedUses('responsables-gasto') },
        { id: 'fB', tenantId: 'beta', name: 'Formato de B', flow: usesTable('responsables-gasto') },
      ],
      definitions: [
        { id: 'd1', tenantId: 'acme', key: 'adq', name: 'Adquisiciones', version: 2, flow: usesTable('responsables-gasto') },
        { id: 'd2', tenantId: 'acme', key: 'sin-flujo', name: 'Sin flujo', version: 1, flow: null },
        { id: 'dB', tenantId: 'beta', key: 'de-b', name: 'De B', version: 1, flow: usesTable('responsables-gasto') },
      ],
    });
    const err: any = await catchErr(svc.remove('tA', A));
    expect(err).toBeInstanceOf(ConflictException);
    const res = err.getResponse();
    expect(res.templates).toEqual([{ id: 'f1', name: 'Adquisiciones' }, { id: 'f3', name: 'Con derivada' }]);
    expect(res.definitions).toEqual([{ key: 'adq', version: 2, name: 'Adquisiciones' }]);
    expect(db.state.tables.some((t: any) => t.id === 'tA')).toBe(true);
    expect(db.state.rows).toHaveLength(1);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('sin referencias la borra con sus filas (cascada) y audita ids y conteo', async () => {
    const { svc, db, audit } = setup({
      rows: [rowOf('acme', 'tA', 0), rowOf('acme', 'tA', 1), rowOf('beta', 'tB', 0)],
      templates: [{ id: 'fB', tenantId: 'beta', name: 'De B', flow: usesTable('responsables-gasto') }], // otro tenant: no cuenta
    });
    await svc.remove('tA', A);
    expect(db.state.tables.map((t: any) => t.id)).toEqual(['tB']);
    expect(db.state.rows.map((r: any) => r.id)).toEqual(['tB-r0']);
    expect(events(audit)[0]).toMatchObject({ tenantId: 'acme', action: 'LOOKUP_TABLE_DELETED', payload: { tableId: 'tA', key: 'responsables-gasto', rowCount: 2 } });
  });

  it('un flujo con forma rota no tumba el borrado', async () => {
    const { svc } = setup({ templates: [{ id: 'x', tenantId: 'acme', name: 'Roto', flow: { steps: 'no' } }, { id: 'y', tenantId: 'acme', name: 'Roto 2', flow: 'texto' }] });
    await expect(svc.remove('tA', A)).resolves.toBeUndefined();
  });
});

describe('prueba (dry-run)', () => {
  const rows = [
    rowOf('acme', 'tA', 0, { area: 'QA', montoMin: 0 }),
    rowOf('acme', 'tA', 1, { area: 'QA', montoMin: 10000, signerId: 'dir' }),
    rowOf('acme', 'tA', 2, {}),
  ];
  const q = (match: any[]) => ({ table: 'responsables-gasto', match });

  it('devuelve coincidencias, la primera y por qué falla cada fila; no escribe ni audita', async () => {
    const { svc, db, audit } = setup({ rows });
    const out = await svc.test('tA', q([{ column: 'area', op: 'eq', source: { var: 'a' } }, { column: 'montoMin', op: 'gte', source: { var: 'monto' } }]), { a: 'qa', monto: 5000 }, 'acme');
    expect(out.first?.rowId).toBe('tA-r0');
    expect(out.matches.map((m) => m.rowId)).toEqual(['tA-r0', 'tA-r2']);
    expect(out.explain.find((e) => e.rowId === 'tA-r1')?.failedAt).toMatchObject({ index: 1, column: 'montoMin', op: 'gte' });
    expect(out.revision).toBe(1);
    expect(audit.append).not.toHaveBeenCalled();
    expect(db.lookupRow.updateMany.mock.calls).toHaveLength(0);
    expect(db.state.tables.find((t: any) => t.id === 'tA').revision).toBe(1);
  });

  it('valida la consulta: forma, tabla, columnas, operadores y valores de prueba', async () => {
    const { svc } = setup({ rows });
    const bad = async (query: any, inputs?: any) => {
      const err: any = await catchErr(svc.test('tA', query, inputs, 'acme'));
      expect(err).toBeInstanceOf(BadRequestException);
      return JSON.stringify(err.getResponse());
    };
    expect(await bad({ table: 'responsables-gasto', match: [] })).toContain('al menos una condición');
    expect(await bad({ table: 'otra', match: [{ column: 'area', op: 'eq', source: { value: 'x' } }] })).toContain('no a «responsables-gasto»');
    expect(await bad(q([{ column: 'noexiste', op: 'eq', source: { value: 'x' } }]))).toContain('no existe en la tabla');
    expect(await bad(q([{ column: 'area', op: 'gt', source: { value: 'x' } }]))).toContain('no aplica a la columna');
    expect(await bad(q([{ column: 'area', op: 'eq', source: { var: 'a' } }]), { a: { x: 1 } })).toContain('texto');
    expect(await bad(q([{ column: 'area', op: 'eq', source: { var: 'a' } }]), { 'a b': 1 })).toContain('no es válida');
    expect(await bad(q([{ column: 'area', op: 'eq', source: { var: 'a' } }]), 'x')).toContain('objeto');
  });

  it('una variable que no viene en inputs simplemente «no trae valor»', async () => {
    const { svc } = setup({ rows });
    const out = await svc.test('tA', q([{ column: 'area', op: 'eq', source: { var: 'a' } }]), {}, 'acme');
    expect(out.matches.map((m) => m.rowId)).toEqual(['tA-r2']); // solo la fila con celda vacía
  });
});

describe('auditoría: nunca valores de celdas', () => {
  it('ningún evento contiene los valores de las filas', async () => {
    const { svc, audit } = setup();
    const secret = { etapa: 'area', area: 'ÁreaSecreta', signerId: 'responsable-secreto', nombre: 'Nombre Secreto', correo: 'secreto@x.mx', montoMin: 123456 };
    const row = await svc.createRow('tA', { values: secret }, A);
    await svc.updateRow('tA', row.id, { values: { ...secret, nombre: 'Otro Secreto' } }, A);
    await svc.importRows('tA', [secret], true, A);
    await svc.reorder('tA', [(await svc.listRows('tA', {}, 'acme')).items[0]!.id], A);
    await svc.update('tA', { name: 'Nombre de tabla', columns: [...columnsFixture, { key: 'x', label: 'Etiqueta nueva', type: 'text' }] }, A);
    const all = JSON.stringify(events(audit));
    for (const s of ['ÁreaSecreta', 'responsable-secreto', 'Nombre Secreto', 'Otro Secreto', 'secreto@x.mx', '123456', 'Nombre de tabla']) expect(all).not.toContain(s);
    expect(events(audit).every((e) => e.tenantId === 'acme' && e.actorId === 'ana')).toBe(true);
    expect(events(audit).map((e) => e.action)).toEqual([
      'LOOKUP_ROW_CREATED', 'LOOKUP_ROW_UPDATED', 'LOOKUP_ROWS_IMPORTED', 'LOOKUP_ROWS_REORDERED', 'LOOKUP_TABLE_UPDATED',
    ]);
  });

  it('si la cadena de auditoría falla, la operación igual se completa (se registra el error)', async () => {
    const { svc, audit, db } = setup();
    audit.append.mockRejectedValueOnce(new Error('cadena caída'));
    await svc.createRow('tA', { values: { signerId: 'u' } }, A);
    expect(db.state.rows).toHaveLength(1);
  });
});
