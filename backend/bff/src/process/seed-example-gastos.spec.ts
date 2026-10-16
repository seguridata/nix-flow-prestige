/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { DocumentTemplatesService } from '../document-templates/document-templates.service';
import { buildFormPdf } from '../document-templates/form-pdf';
import { parseTemplateMeta } from '../document-templates/template-meta';
import { LookupTablesService } from '../lookup-tables/lookup-tables.service';
import { FlowResolverService } from '../lookup-tables/flow-resolver.service';
import { makeLookupDb } from '../lookup-tables/lookup-tables.fixtures';
import { parseAttachmentSpecs } from '../attachments/attachment-specs';
import { validateFlow } from '../flow/flow';
import { DEFAULT_SIGNATURE_POLICY } from '../signing/signature-policy';
import { MAX_STEPS } from '../flow/flow.types';
import { ADQUISICIONES_FLOW, AREAS, CONCEPTOS, ROL_EJECUTIVO_AYT, TABLA_RESPONSABLES, TABLA_ROLES, TIPOS_GASTO } from './adquisiciones.flows';
import {
  EXAMPLE_ATTACHMENTS,
  FORM_CATEGORY,
  FORM_NAME,
  RESPONSABLES_TABLE,
  ROLES_EXAMPLE_ROW,
  ROLES_TABLE,
  SEED_ACTOR_ID,
  USAGE,
  exampleFlow,
  exampleFormBody,
  formDiff,
  formatReport,
  parseSeedArgs,
  runSeed,
  validateExample,
  type SeedOptions,
  type SeedReport,
} from '../../prisma/scripts/seed-example-gastos.lib';

const opts = (over: Partial<SeedOptions> = {}): SeedOptions => ({ tenant: 'seguridata', dryRun: false, force: false, ...over });

/** Mundo en memoria con los servicios REALES (tablas de consulta y formatos): mismas validaciones que la API. */
function world(seed: Parameters<typeof makeLookupDb>[0] = {}, allowedMethods: string[] = [...DEFAULT_SIGNATURE_POLICY.allowedMethods]) {
  const db: any = makeLookupDb(seed);
  const templates = new Map<string, any>();
  let n = 0;
  db.documentTemplate = {
    findFirst: vi.fn(async ({ where }: any) =>
      [...templates.values()].find(
        (r) =>
          (!where.id || r.id === where.id) &&
          (!where.tenantId || r.tenantId === where.tenantId) &&
          (where.published === undefined || r.published === where.published) &&
          (!where.name || r.name.toLowerCase() === String(where.name.equals).toLowerCase()),
      ) ?? null,
    ),
    findMany: vi.fn(async ({ where }: any) =>
      [...templates.values()].filter((r) => (!where.tenantId || r.tenantId === where.tenantId) && (where.published === undefined || r.published === where.published)),
    ),
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `tpl${++n}`, createdAt: new Date(), kind: 'PDF', flowKey: null, flowVersion: null, ...data };
      templates.set(row.id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      templates.set(where.id, { ...templates.get(where.id), ...data });
      return templates.get(where.id);
    }),
  };
  const objects = new Map<string, Buffer>();
  let k = 0;
  const storage: any = {
    putObject: vi.fn(async (o: any) => {
      const key = `${o.prefix}/u${++k}-${o.filename}`;
      objects.set(key, o.bytes);
      return { objectKey: key, sizeBytes: o.bytes.length, enc: { alg: 'x' } };
    }),
    deleteObject: vi.fn(async (key: string) => void objects.delete(key)),
  };
  const audit = { append: vi.fn(async () => ({})) };
  const resolver = new FlowResolverService(db, audit as any);
  const tables = new LookupTablesService(db, audit as any);
  const policy: any = { resolve: vi.fn(async () => ({ ...DEFAULT_SIGNATURE_POLICY, version: 4, source: 'tenant', allowedMethods })) };
  const tpl = new DocumentTemplatesService(db, storage, {} as any, {} as any, {} as any, {} as any, resolver, {} as any, policy);
  const run = (o: Partial<SeedOptions> = {}) => runSeed({ tables, templates: tpl }, opts(o));
  const stored = () => [...templates.values()];
  const tableByKey = (tenantId: string, key: string) => db.state.tables.find((t: any) => t.tenantId === tenantId && t.key === key);
  const rowsOf = (tableId: string) => db.state.rows.filter((r: any) => r.tableId === tableId);
  return { db, run, tables, tpl, resolver, templates, stored, storage, objects, audit, tableByKey, rowsOf };
}

const levels = (r: SeedReport) => r.lines.map((l) => l.level);
const has = (r: SeedReport, level: string, re: RegExp) => r.lines.some((l) => l.level === level && re.test(l.text));

const respTable = (tenantId = 'seguridata') => ({ id: `resp-${tenantId}`, tenantId, key: TABLA_RESPONSABLES, name: 'Responsables de gasto', columns: RESPONSABLES_TABLE.columns, createdBy: 'migracion' });
const respRow = (tableId: string, i: number, values: Record<string, unknown>, tenantId = 'seguridata') => ({ id: `${tableId}-r${i}`, tenantId, tableId, position: i, values });

describe('armado del ejemplo', () => {
  it('el flujo del ejemplo pasa validateFlow y no pasa del máximo de pasos', () => {
    expect(validateFlow(exampleFlow())).toEqual([]);
    expect(exampleFlow().steps.length).toBeLessThanOrEqual(MAX_STEPS);
    expect(validateExample()).toEqual([]);
  });

  it('es el flujo de ADQUISICIONES_FLOW con las tres variables nuevas al final, sin tocar el original', () => {
    const f = exampleFlow();
    expect(f.steps).toEqual(ADQUISICIONES_FLOW.steps);
    expect(f.order).toBe(ADQUISICIONES_FLOW.order);
    expect(f.slaHours).toBe(ADQUISICIONES_FLOW.slaHours);
    expect(f.variables.map((v) => v.key)).toEqual(['area', 'tipoGasto', 'concepto', 'modalidadGasto', 'monto', 'descripcion', 'justificacion', 'proyecto']);
    expect(ADQUISICIONES_FLOW.variables).toHaveLength(5); // el original no se muta
    expect(f.steps).not.toBe(ADQUISICIONES_FLOW.steps);
  });

  it('variables: las de Adquisiciones (mismas opciones) más descripción y justificación obligatorias y proyecto opcional', () => {
    const v = Object.fromEntries(exampleFlow().variables.map((x) => [x.key, x]));
    expect(v.area).toMatchObject({ type: 'select', required: true, options: [...AREAS] });
    expect(v.tipoGasto).toMatchObject({ type: 'select', required: true, options: [...TIPOS_GASTO] });
    expect(v.concepto).toMatchObject({ type: 'select', required: true, options: [...CONCEPTOS] });
    expect(v.monto).toMatchObject({ type: 'number', required: true });
    expect(v.descripcion).toEqual({ key: 'descripcion', label: 'Descripción de la necesidad', type: 'text', required: true });
    expect(v.justificacion).toMatchObject({ type: 'text', required: true });
    expect(v.proyecto).toEqual({ key: 'proyecto', label: 'Proyecto asociado', type: 'text', required: false });
  });

  it('anexos: cotizaciones (obligatorio, 3 a 6, 15 MB) y otros (opcional, 0 a 5); pasan parseAttachmentSpecs', () => {
    const { specs, errors } = parseAttachmentSpecs(EXAMPLE_ATTACHMENTS);
    expect(errors).toEqual([]);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toEqual({
      key: 'cotizaciones',
      label: 'Cotizaciones del proveedor',
      help: 'Adjunta al menos 3 cotizaciones de proveedores distintos',
      required: true,
      min: 3,
      max: 6,
      accept: ['pdf', 'image', 'excel', 'word'],
      maxSizeMB: 15,
    });
    expect(specs[1]).toMatchObject({ key: 'otros', label: 'Otros documentos de soporte', required: false, min: 0, max: 5 });
  });

  it('cuerpo del formato: nombre, categoría y SIN métodos fijos (los calcula la política del tenant)', () => {
    const b = exampleFormBody();
    expect(b.name).toBe('Solicitud de gastos (Adquisiciones)');
    expect(b.category).toBe('Administración y finanzas');
    expect(b.methods).toEqual([]);
    expect(b.description.length).toBeLessThanOrEqual(500);
  });

  it('tablas: roles-adquisiciones (rol, signerId, nombre, correo) y el esquema de la matriz migrada', () => {
    expect(ROLES_TABLE.key).toBe('roles-adquisiciones');
    expect(ROLES_TABLE.columns.map((c) => c.key)).toEqual(['rol', 'signerId', 'nombre', 'correo']);
    expect(ROLES_TABLE.description).toMatch(/EJEMPLO EDITABLE/);
    expect(ROLES_EXAMPLE_ROW).toEqual({ rol: ROL_EJECUTIVO_AYT, signerId: 'javazquez', nombre: 'Jesús Vázquez', correo: 'javazquez@seguridata.com' });
    expect(RESPONSABLES_TABLE.key).toBe(TABLA_RESPONSABLES);
    expect(RESPONSABLES_TABLE.columns.map((c) => c.key)).toEqual(['etapa', 'area', 'tipoGasto', 'concepto', 'modalidadGasto', 'solicitante', 'montoMin', 'montoMax', 'signerId', 'nombre', 'correo']);
    expect(RESPONSABLES_TABLE.columns[0]).toMatchObject({ type: 'select', options: ['area', 'tipoGasto'] });
  });

  it('la hoja base se genera y el formato completo pasa parseTemplateMeta (campos y cajas de firma por paso)', async () => {
    const b = exampleFormBody();
    const gen = await buildFormPdf({ name: b.name, description: b.description, variables: b.flow.variables, steps: b.flow.steps, attachmentSpecs: b.attachmentSpecs });
    const { meta, errors } = parseTemplateMeta({ ...b, fields: gen.fields, signatureBoxes: gen.signatureBoxes }, gen.pageCount);
    expect(errors).toEqual([]);
    expect(meta!.fields).toHaveLength(8);
    expect(meta!.signatureBoxes).toHaveLength(b.flow.steps.length);
    expect(meta!.attachmentSpecs).toHaveLength(2);
  });
});

describe('argumentos', () => {
  it('por defecto: tenant seguridata, sin dry-run ni force', () => {
    expect(parseSeedArgs([])).toEqual({ ok: true, options: { tenant: 'seguridata', dryRun: false, force: false } });
  });

  it('--tenant, --dry-run y --force (con o sin «--» de bun)', () => {
    expect(parseSeedArgs(['--', '--tenant', 'acme', '--dry-run', '--force'])).toEqual({ ok: true, options: { tenant: 'acme', dryRun: true, force: true } });
    expect(parseSeedArgs(['--tenant=beta'])).toMatchObject({ ok: true, options: { tenant: 'beta' } });
  });

  it('rechaza slugs inválidos, banderas desconocidas y --tenant sin valor; --help muestra el uso', () => {
    expect(parseSeedArgs(['--tenant', 'Acme Corp'])).toMatchObject({ ok: false, help: false });
    expect(parseSeedArgs(['--nope'])).toMatchObject({ ok: false });
    expect(parseSeedArgs(['--tenant'])).toMatchObject({ ok: false });
    expect(parseSeedArgs(['--help'])).toMatchObject({ ok: false, help: true });
    expect(USAGE).toContain('--dry-run');
  });
});

describe('runSeed con los servicios reales sobre datos en memoria', () => {
  it('primera corrida: crea roles y la matriz vacía, el formato publicado, y avisa que falta importar la matriz', async () => {
    const w = world();
    const r = await w.run();
    expect(has(r, 'creado', /roles-adquisiciones/)).toBe(true);
    expect(has(r, 'creado', /responsables-gasto.*vacía/)).toBe(true);
    expect(has(r, 'pendiente', /importar la matriz/)).toBe(true);
    expect(has(r, 'creado', /Formato digital/)).toBe(true);
    expect(r.exitCode).toBe(3);

    const roles = w.tableByKey('seguridata', 'roles-adquisiciones');
    expect(roles.columns.map((c: any) => c.key)).toEqual(['rol', 'signerId', 'nombre', 'correo']);
    expect(roles.description).toMatch(/EJEMPLO EDITABLE/);
    expect(w.rowsOf(roles.id).map((x: any) => x.values)).toEqual([ROLES_EXAMPLE_ROW]);
    const resp = w.tableByKey('seguridata', TABLA_RESPONSABLES);
    expect(resp.columns).toEqual(RESPONSABLES_TABLE.columns);
    expect(w.rowsOf(resp.id)).toHaveLength(0);

    const [form] = w.stored();
    expect(w.stored()).toHaveLength(1);
    expect(form).toMatchObject({ tenantId: 'seguridata', name: FORM_NAME, kind: 'FORM', category: FORM_CATEGORY, published: true, methods: ['ACCEPT', 'AUTOGRAFA', 'DIGITAL'], createdBy: SEED_ACTOR_ID });
    expect(has(r, 'creado', /Métodos de firma: ACCEPT, AUTOGRAFA, DIGITAL/)).toBe(true);
    expect(form.flow.variables.map((v: any) => v.key)).toEqual(['area', 'tipoGasto', 'concepto', 'modalidadGasto', 'monto', 'descripcion', 'justificacion', 'proyecto']);
    expect(form.attachmentSpecs.map((s: any) => s.key)).toEqual(['cotizaciones', 'otros']);
    expect(form.fields).toHaveLength(8);
    expect(form.signatureBoxes).toHaveLength(form.flow.steps.length);
  });

  it('tenant que solo permite DIGITAL y AUTOGRAFA (seguridata): no guarda ACCEPT, publica y lo informa', async () => {
    const w = world({}, ['DIGITAL', 'AUTOGRAFA']);
    const r = await w.run();
    expect(levels(r)).not.toContain('error');
    expect(w.stored()).toHaveLength(1);
    expect(w.stored()[0]).toMatchObject({ published: true, methods: ['AUTOGRAFA', 'DIGITAL'] });
    expect(has(r, 'creado', /Métodos de firma: AUTOGRAFA, DIGITAL\./)).toBe(true);
    // el formato publicado sigue sin diferencias en la siguiente corrida (los métodos no se comparan)
    expect(has(await w.run(), 'existe', /sin cambios.*Métodos de firma: AUTOGRAFA, DIGITAL/)).toBe(true);
  });

  it('idempotente: la segunda corrida no crea ni escribe nada', async () => {
    const w = world();
    await w.run();
    const antes = { tablas: w.db.state.tables.length, filas: w.db.state.rows.length, tpl: w.stored().length, puts: w.storage.putObject.mock.calls.length, snapshot: JSON.stringify(w.stored()) };
    const createTable = w.db.lookupTable.create.mock.calls.length;
    const createRow = w.db.lookupRow.create.mock.calls.length;
    const r = await w.run();
    expect(w.db.state.tables).toHaveLength(antes.tablas);
    expect(w.db.state.rows).toHaveLength(antes.filas);
    expect(w.db.lookupTable.create.mock.calls).toHaveLength(createTable);
    expect(w.db.lookupRow.create.mock.calls).toHaveLength(createRow);
    expect(w.db.documentTemplate.create.mock.calls).toHaveLength(1);
    expect(w.db.documentTemplate.update.mock.calls).toHaveLength(1); // solo el de «publicar» de la primera corrida
    expect(w.storage.putObject.mock.calls).toHaveLength(antes.puts);
    expect(JSON.stringify(w.stored())).toBe(antes.snapshot);
    expect(levels(r).filter((l) => l === 'creado')).toEqual([]);
    expect(has(r, 'existe', /Formato.*sin cambios/)).toBe(true);
  });

  it('con la matriz ya importada y todo en orden no hay pendientes: código 0', async () => {
    const w = world({ tables: [respTable()], rows: [respRow('resp-seguridata', 0, { etapa: 'area', area: 'QA', signerId: 'jefe-qa' })] });
    const r = await w.run();
    expect(has(r, 'existe', /responsables-gasto.*1 filas/)).toBe(true);
    expect(levels(r)).not.toContain('pendiente');
    expect(levels(r)).not.toContain('error');
    expect(r.exitCode).toBe(0);
    expect(w.tableByKey('seguridata', TABLA_RESPONSABLES).columns).toEqual(RESPONSABLES_TABLE.columns); // no se tocó
    expect((await w.run()).exitCode).toBe(0);
  });

  it('dry-run: informa lo que haría y no escribe nada', async () => {
    const w = world();
    const r = await w.run({ dryRun: true });
    expect(levels(r).every((l) => l === 'dry-run' || l === 'pendiente')).toBe(true);
    expect(r.lines.filter((l) => l.level === 'dry-run').length).toBeGreaterThanOrEqual(3);
    expect(w.db.state.tables).toHaveLength(0);
    expect(w.db.state.rows).toHaveLength(0);
    expect(w.stored()).toHaveLength(0);
    expect(w.storage.putObject).not.toHaveBeenCalled();
    expect(formatReport(r, opts({ dryRun: true }))).toMatch(/DRY-RUN/);
  });

  it('no pisa lo que el administrador ya editó: la fila de roles con otra persona se conserva', async () => {
    const roles = { id: 'rol-t', tenantId: 'seguridata', key: TABLA_ROLES, name: 'Roles', columns: ROLES_TABLE.columns, createdBy: 'admin' };
    const w = world({ tables: [roles, respTable()], rows: [{ id: 'rr', tenantId: 'seguridata', tableId: 'rol-t', position: 0, values: { rol: ROL_EJECUTIVO_AYT, signerId: 'maria.real', nombre: 'María Real' } }] });
    const r = await w.run();
    expect(has(r, 'existe', /roles-adquisiciones.*1 filas/)).toBe(true);
    expect(w.rowsOf('rol-t')).toHaveLength(1);
    expect(w.rowsOf('rol-t')[0].values.signerId).toBe('maria.real');
    expect(w.db.lookupTable.create.mock.calls).toHaveLength(0);
  });

  it('una tabla de roles vacía (corrida interrumpida) recibe la fila de ejemplo', async () => {
    const roles = { id: 'rol-t', tenantId: 'seguridata', key: TABLA_ROLES, name: 'Roles', columns: ROLES_TABLE.columns, createdBy: 'seed' };
    const w = world({ tables: [roles, respTable()] });
    const r = await w.run();
    expect(has(r, 'creado', /Fila de ejemplo/)).toBe(true);
    expect(w.rowsOf('rol-t').map((x: any) => x.values)).toEqual([ROLES_EXAMPLE_ROW]);
  });

  it('tabla inactiva: error, no se crea el formato', async () => {
    const w = world({ tables: [{ ...respTable(), active: false }] });
    const r = await w.run();
    expect(r.exitCode).toBe(1);
    expect(has(r, 'error', /inactiva/)).toBe(true);
    expect(w.stored()).toHaveLength(0);
  });

  it('el flujo cambió y el formato está publicado: lo informa y NO lo sobrescribe', async () => {
    const w = world();
    await w.run();
    const [form] = w.stored();
    form.flow = { ...form.flow, steps: form.flow.steps.slice(0, 5) };
    const antes = JSON.stringify(w.stored());
    const puts = w.storage.putObject.mock.calls.length;
    const r = await w.run();
    expect(has(r, 'pendiente', /difiere.*flujo y variables.*--force/)).toBe(true);
    expect(r.exitCode).toBe(3);
    expect(JSON.stringify(w.stored())).toBe(antes);
    expect(w.stored()[0].published).toBe(true);
    expect(w.storage.putObject.mock.calls).toHaveLength(puts);
  });

  it('--force: despublica, regenera, vuelve a publicar y deja el flujo del ejemplo', async () => {
    const w = world();
    await w.run();
    const [form] = w.stored();
    form.flow = { ...form.flow, steps: form.flow.steps.slice(0, 5) };
    form.attachmentSpecs = [];
    const id = form.id;
    const r = await w.run({ force: true });
    expect(has(r, 'creado', /regenerado y publicado.*flujo y variables, anexos/)).toBe(true);
    expect(w.stored()).toHaveLength(1);
    const after = w.stored()[0];
    expect(after.id).toBe(id);
    expect(after.published).toBe(true);
    expect(after.flow).toEqual(exampleFlow());
    expect(after.attachmentSpecs.map((s: any) => s.key)).toEqual(['cotizaciones', 'otros']);
    // y una corrida posterior ya no ve diferencias
    const again = await w.run();
    expect(has(again, 'existe', /sin cambios/)).toBe(true);
  });

  it('--force con --dry-run: dice qué haría y no toca nada', async () => {
    const w = world();
    await w.run();
    w.stored()[0].flow = { ...w.stored()[0].flow, steps: w.stored()[0].flow.steps.slice(0, 5) };
    const antes = JSON.stringify(w.stored());
    const r = await w.run({ force: true, dryRun: true });
    expect(has(r, 'dry-run', /despublicaría, regeneraría y publicaría/)).toBe(true);
    expect(JSON.stringify(w.stored())).toBe(antes);
  });

  it('un formato sin publicar y sin cambios se deja como está y se avisa (no se publica en silencio)', async () => {
    const w = world();
    await w.run();
    w.stored()[0].published = false;
    const r = await w.run();
    expect(has(r, 'existe', /sin publicar/)).toBe(true);
    expect(has(r, 'pendiente', /sin publicar.*--force/)).toBe(true);
    expect(w.stored()[0].published).toBe(false);
  });

  it('si ya existe un formato con ese nombre pero con su propio PDF, error y no lo toca', async () => {
    const w = world();
    await w.run();
    w.stored()[0].kind = 'PDF';
    const r = await w.run({ force: true });
    expect(r.exitCode).toBe(1);
    expect(has(r, 'error', /propio PDF/)).toBe(true);
  });

  it('multitenant: cada tenant recibe lo suyo y no se toca el de otro', async () => {
    const w = world({ tables: [respTable('acme'), respTable('seguridata')] });
    await w.run({ tenant: 'acme' });
    expect(w.tableByKey('acme', TABLA_ROLES)).toBeTruthy();
    expect(w.tableByKey('seguridata', TABLA_ROLES)).toBeUndefined();
    expect(w.stored().map((t) => t.tenantId)).toEqual(['acme']);
    await w.run({ tenant: 'seguridata' });
    expect(w.stored().map((t) => t.tenantId).sort()).toEqual(['acme', 'seguridata']);
    expect(w.db.state.tables.filter((t: any) => t.key === TABLA_ROLES).map((t: any) => t.tenantId).sort()).toEqual(['acme', 'seguridata']);
    // cada formato de cada tenant se archiva con su tenant (prefijo del almacén)
    const prefixes = w.storage.putObject.mock.calls.map((c: any[]) => c[0].prefix).sort();
    expect(prefixes).toEqual(['templates/acme', 'templates/seguridata']);
  });

  it('los errores de validación del servicio salen con su detalle y código 1', async () => {
    const w = world({ tables: [{ ...respTable(), columns: [{ key: 'etapa', label: 'Etapa', type: 'text' }] }] });
    const r = await w.run();
    expect(r.exitCode).toBe(1);
    expect(has(r, 'error', /consulta tablas que no cuadran/)).toBe(true);
    expect(w.stored()).toHaveLength(0);
  });
});

describe('el ejemplo funciona de punta a punta con la tabla de roles y la matriz', () => {
  it('un usuario llena la solicitud: el sistema resuelve solo a quién va cada paso, y sin la tabla de roles degrada a «preguntar»', async () => {
    const w = world({
      tables: [respTable()],
      rows: [
        respRow('resp-seguridata', 0, { etapa: 'area', area: 'QA', signerId: 'jefe-qa', nombre: 'Jefe QA' }),
        respRow('resp-seguridata', 1, { etapa: 'tipoGasto', tipoGasto: 'Viaje', concepto: 'Gastos de Viaje', signerId: 'dir-viajes', nombre: 'Dir Viajes' }),
      ],
    });
    await w.run();
    const flow = w.stored()[0].flow;
    const valores = { area: 'QA', tipoGasto: 'Viaje', concepto: 'Gastos de Viaje', monto: 8000, descripcion: 'Vuelo', justificacion: 'Cliente' };
    const r = await w.resolver.resolve(flow, valores, 'seguridata');
    expect(r.picks.get('AUT_AREA')?.signerId).toBe('jefe-qa');
    expect(r.picks.get('AUT_TIPO')?.signerId).toBe('dir-viajes');
    expect(r.picks.get('T02')).toEqual({ signerId: 'javazquez', name: 'Jesús Vázquez', email: 'javazquez@seguridata.com' });
    expect(r.picks.get('T17')?.signerId).toBe('javazquez');
    expect(r.picks.has('T10')).toBe(false); // solicitante: iniciador

    // El administrador cambia a la persona desde la tabla, sin tocar código.
    const roles = w.tableByKey('seguridata', TABLA_ROLES);
    w.rowsOf(roles.id)[0].values.signerId = 'otra.persona';
    expect((await w.resolver.resolve(flow, valores, 'seguridata')).picks.get('T02')?.signerId).toBe('otra.persona');

    // Un tenant sin la tabla de roles: degrada a «preguntar» sin error.
    const otro = await w.resolver.resolve(flow, valores, 'sin-roles');
    expect(otro.picks.get('T02')).toBeNull();
  });
});

describe('formDiff', () => {
  const desired = exampleFormBody();
  const current = (over: Record<string, unknown> = {}) => ({
    id: 'x',
    name: FORM_NAME,
    kind: 'FORM',
    published: true,
    description: desired.description,
    category: desired.category,
    flow: JSON.parse(JSON.stringify(desired.flow)),
    methods: ['ACCEPT'],
    attachmentSpecs: JSON.parse(JSON.stringify(desired.attachmentSpecs)),
    ...over,
  });

  it('sin diferencias aunque jsonb reordene las llaves', () => {
    const reordered = { ...desired.flow, steps: desired.flow.steps.map((s) => Object.fromEntries(Object.entries(s).reverse())) };
    expect(formDiff(current({ flow: reordered }), desired)).toEqual([]);
  });

  it('nombra lo que cambió', () => {
    expect(formDiff(current({ category: 'Otra' }), desired)).toEqual(['categoría']);
    // sin métodos deseados (los calcula la política) no se comparan; con métodos explícitos sí
    expect(formDiff(current({ methods: ['DIGITAL'] }), desired)).toEqual([]);
    expect(formDiff(current({ methods: ['DIGITAL'] }), { ...desired, methods: ['ACCEPT'] })).toEqual(['métodos de firma']);
    expect(formDiff(current({ attachmentSpecs: [] }), desired)).toEqual(['anexos']);
    expect(formDiff(current({ description: null }), desired)).toEqual(['descripción']);
    expect(formDiff(current({ flow: { ...desired.flow, slaHours: 24 } }), desired)).toEqual(['flujo y variables']);
  });
});
