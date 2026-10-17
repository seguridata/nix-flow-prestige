/**
 * Lógica (sin Nest ni BD; solo puertos) de `seed-example-gastos.ts`: arma las tablas de consulta y el formato digital del
 * ejemplo «Solicitud de gastos / Adquisiciones» y los carga de forma idempotente. Se prueba en
 * src/process/seed-example-gastos.spec.ts con un fixture en memoria.
 *
 * Lo que decide a quién va cada paso vive en TABLAS (ADR-008): el administrador cambia a una persona desde la pantalla de
 * tablas, sin tocar código. Este script solo deja un ejemplo funcional por tenant.
 */
import { ADQUISICIONES_FLOW, ROL_EJECUTIVO_AYT, TABLA_RESPONSABLES, TABLA_ROLES } from '../../src/process/adquisiciones.flows';
import { parseAttachmentSpecs, type AttachmentSpec } from '../../src/attachments/attachment-specs';
import { validateFlow } from '../../src/flow/flow';
import type { Flow } from '../../src/flow/flow.types';

export const DEFAULT_TENANT = 'seguridata';
export const FORM_NAME = 'Solicitud de gastos (Adquisiciones)';
export const FORM_CATEGORY = 'Administración y finanzas';
export const SEED_ACTOR_ID = 'system:seed-example-gastos';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

// ───────────────────────────── argumentos ─────────────────────────────

export interface SeedOptions {
  tenant: string;
  dryRun: boolean;
  force: boolean;
}

export type ParsedArgs = { ok: true; options: SeedOptions } | { ok: false; errors: string[]; help: boolean };

export const USAGE = `Uso:
  bun run seed:example-gastos -- [--tenant <slug>] [--dry-run] [--force]

  --tenant   slug del tenant (por defecto: ${DEFAULT_TENANT}; también por entorno SEED_TENANT)
  --dry-run  no escribe nada; solo informa qué haría
  --force    si el formato ya existe y su flujo, anexos o variables cambiaron: lo despublica, lo regenera y lo vuelve a publicar
  --help     muestra esta ayuda`;

export function parseSeedArgs(argv: readonly string[], env: Record<string, string | undefined> = {}): ParsedArgs {
  const errors: string[] = [];
  let tenant = env.SEED_TENANT?.trim() || DEFAULT_TENANT;
  let dryRun = false;
  let force = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') continue;
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--force') force = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--tenant' || arg.startsWith('--tenant=')) {
      const v = arg === '--tenant' ? argv[++i] : arg.slice('--tenant='.length);
      if (!v || v.startsWith('--')) errors.push('--tenant necesita un valor');
      else tenant = v.trim();
    } else errors.push(`Argumento desconocido: ${arg}`);
  }
  if (help) return { ok: false, errors: [], help: true };
  if (!SLUG_RE.test(tenant)) errors.push('El tenant debe ser un slug: minúsculas, dígitos y guiones');
  return errors.length ? { ok: false, errors, help: false } : { ok: true, options: { tenant, dryRun, force } };
}

// ───────────────────────────── armado ─────────────────────────────

type Col = { key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options?: string[] };

export interface TableSpec {
  key: string;
  name: string;
  description: string;
  columns: Col[];
}

/** Mismo esquema que la tabla migrada por 20261018100000 (la que consultan AUT_AREA, AUT_TIPO, T26 y T27). */
export const RESPONSABLES_TABLE: TableSpec = {
  key: TABLA_RESPONSABLES,
  name: 'Responsables de gasto',
  description: 'Quién autoriza cada gasto según área, tipo, concepto y monto. De lo más específico a lo más general: gana la primera fila que coincide.',
  columns: [
    { key: 'etapa', label: 'Etapa', type: 'select', options: ['area', 'tipoGasto'] },
    { key: 'area', label: 'Área del solicitante', type: 'text' },
    { key: 'tipoGasto', label: 'Tipo de gasto', type: 'text' },
    { key: 'concepto', label: 'Concepto', type: 'text' },
    { key: 'modalidadGasto', label: 'Modalidad del gasto', type: 'text' },
    { key: 'solicitante', label: 'Usuario solicitante (autenticado)', type: 'text' },
    { key: 'montoMin', label: 'Monto desde', type: 'number' },
    { key: 'montoMax', label: 'Monto hasta', type: 'number' },
    { key: 'signerId', label: 'Usuario responsable', type: 'text' },
    { key: 'nombre', label: 'Nombre', type: 'text' },
    { key: 'correo', label: 'Correo', type: 'text' },
  ],
};

export const ROLES_TABLE: TableSpec = {
  key: TABLA_ROLES,
  name: 'Roles de Adquisiciones',
  description:
    'EJEMPLO EDITABLE. Quién ocupa cada rol fijo del proceso de Adquisiciones. El administrador cambia a la persona real desde esta pantalla, sin tocar código.',
  columns: [
    { key: 'rol', label: 'Rol', type: 'text' },
    { key: 'signerId', label: 'Usuario', type: 'text' },
    { key: 'nombre', label: 'Nombre', type: 'text' },
    { key: 'correo', label: 'Correo', type: 'text' },
  ],
};

/** Fila de ejemplo: el administrador la reemplaza por la persona real. */
export const ROLES_EXAMPLE_ROW = {
  rol: ROL_EJECUTIVO_AYT,
  signerId: 'javazquez',
  nombre: 'Jesús Vázquez',
  correo: 'javazquez@seguridata.com',
};

export const EXAMPLE_VARIABLES: Flow['variables'] = [
  { key: 'descripcion', label: 'Descripción de la necesidad', type: 'text', required: true },
  { key: 'justificacion', label: 'Justificación', type: 'text', required: true },
  { key: 'proyecto', label: 'Proyecto asociado', type: 'text', required: false },
];

export const EXAMPLE_ATTACHMENTS: AttachmentSpec[] = [
  {
    key: 'cotizaciones',
    label: 'Cotizaciones del proveedor',
    help: 'Adjunta al menos 3 cotizaciones de proveedores distintos',
    required: true,
    min: 3,
    max: 6,
    accept: ['pdf', 'image', 'excel', 'word'],
    maxSizeMB: 15,
  },
  { key: 'otros', label: 'Otros documentos de soporte', required: false, min: 0, max: 5, accept: ['any'], maxSizeMB: 15 },
];

/** El flujo del ejemplo = el flujo por defecto de Adquisiciones con las variables de captura añadidas. */
export function exampleFlow(): Flow {
  const flow = JSON.parse(JSON.stringify(ADQUISICIONES_FLOW)) as Flow;
  flow.variables = [...flow.variables, ...JSON.parse(JSON.stringify(EXAMPLE_VARIABLES))];
  return flow;
}

export interface FormBody {
  name: string;
  description: string;
  category: string;
  flow: Flow;
  /** Origen versionado del flujo contenido en el formato. */
  flowKey: string;
  flowVersion: number;
  methods: string[];
  attachmentSpecs: AttachmentSpec[];
}

export function exampleFormBody(): FormBody {
  return {
    name: FORM_NAME,
    description:
      'Solicitud de gasto o compra. Captura el área, el tipo y concepto de gasto y el monto, adjunta al menos 3 cotizaciones y el sistema envía cada paso a quien corresponde según la matriz de responsables.',
    category: FORM_CATEGORY,
    flow: exampleFlow(),
    flowKey: 'adquisiciones-gastos',
    flowVersion: 1,
    // Vacío a propósito: el servicio calcula los métodos según la política de firma del tenant (no se fija ACCEPT).
    methods: [],
    attachmentSpecs: JSON.parse(JSON.stringify(EXAMPLE_ATTACHMENTS)) as AttachmentSpec[],
  };
}

/** Errores de armado (deben ser vacíos): flujo y anexos pasan las mismas validaciones que el servicio. */
export function validateExample(body: FormBody = exampleFormBody()): string[] {
  return [...validateFlow(body.flow), ...parseAttachmentSpecs(body.attachmentSpecs).errors];
}

// ───────────────────────────── comparación ─────────────────────────────

const sortDeep = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortDeep)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]))
      : v;
/** JSON con llaves ordenadas: jsonb no conserva el orden de las llaves. */
export const canon = (v: unknown): string => JSON.stringify(sortDeep(v ?? null));

export interface FormDetailLike {
  id: string;
  name: string;
  kind?: string;
  published: boolean;
  description?: string | null;
  category?: string | null;
  flow: unknown;
  flowKey?: string | null;
  flowVersion?: number | null;
  methods: unknown;
  attachmentSpecs: unknown;
}

/** Qué partes del formato existente ya no coinciden con lo que armaría este script. */
export function formDiff(current: FormDetailLike, desired: FormBody): string[] {
  const out: string[] = [];
  if (canon(current.flow) !== canon(desired.flow)) out.push('flujo y variables');
  if ((current.flowKey ?? null) !== desired.flowKey || (current.flowVersion ?? null) !== desired.flowVersion) out.push('flujo asociado');
  const specs = parseAttachmentSpecs(current.attachmentSpecs).specs;
  if (canon(specs) !== canon(parseAttachmentSpecs(desired.attachmentSpecs).specs)) out.push('anexos');
  const methods = (m: unknown) => (Array.isArray(m) ? [...m].map(String).sort() : []);
  // Sin métodos deseados = «los que calcule la política»: no se comparan (y no se regenera por ellos).
  if (desired.methods.length && canon(methods(current.methods)) !== canon(methods(desired.methods))) out.push('métodos de firma');
  if ((current.category ?? null) !== desired.category) out.push('categoría');
  if ((current.description ?? null) !== desired.description) out.push('descripción');
  return out;
}

// ───────────────────────────── puertos y ejecución ─────────────────────────────

export interface SeedActor {
  tenantId: string;
  actorId: string;
  name?: string;
  isAdmin: boolean;
}

export interface TablesPort {
  list(tenantId: string): Promise<{ id: string; key: string; active: boolean; rowCount: number }[]>;
  create(raw: unknown, actor: SeedActor): Promise<{ id: string }>;
  createRow(id: string, raw: unknown, actor: SeedActor): Promise<unknown>;
}

export interface TemplatesPort {
  list(actor: SeedActor, all: boolean): Promise<{ id: string; name: string }[]>;
  get(id: string, actor: SeedActor): Promise<FormDetailLike>;
  update(id: string, patch: { flowKey: string; flowVersion: number }, actor: SeedActor): Promise<unknown>;
  createForm(body: unknown, actor: SeedActor): Promise<{ id: string }>;
  setPublished(id: string, published: boolean, actor: SeedActor): Promise<unknown>;
}

export type Level = 'creado' | 'existe' | 'pendiente' | 'error' | 'dry-run';
export interface ReportLine {
  level: Level;
  text: string;
}
export interface SeedReport {
  lines: ReportLine[];
  /** 0 = todo en orden; 1 = hubo errores; 3 = falta algo que decidir o importar (pendientes). */
  exitCode: 0 | 1 | 3;
}

/** Mensaje legible de una excepción de Nest (400 con `errors`, 409…) o de cualquier Error. */
export function describeError(e: unknown): string {
  const err = e as { message?: string; getResponse?: () => unknown };
  const res = typeof err?.getResponse === 'function' ? err.getResponse() : undefined;
  const list = res && typeof res === 'object' ? (res as { errors?: unknown }).errors : undefined;
  const base = err?.message ?? String(e);
  return Array.isArray(list) && list.length ? `${base}: ${list.map(String).join('; ')}` : base;
}

/** «Métodos de firma: A, B» (los que quedaron guardados), para el informe. */
function methodsText(m: unknown): string {
  const list = Array.isArray(m) ? m.map(String) : [];
  return list.length ? `Métodos de firma: ${list.join(', ')}.` : 'Métodos de firma: ninguno guardado (se calculan según la política al llenar el formato).';
}

export async function runSeed(deps: { tables: TablesPort; templates: TemplatesPort }, options: SeedOptions): Promise<SeedReport> {
  const lines: ReportLine[] = [];
  const add = (level: Level, text: string) => lines.push({ level, text });
  const { dryRun, force } = options;
  const actor: SeedActor = { tenantId: options.tenant, actorId: SEED_ACTOR_ID, name: 'Seed ejemplo gastos', isAdmin: true };
  const would = (text: string) => add('dry-run', `se ${text}`);

  const buildErrors = validateExample();
  if (buildErrors.length) {
    add('error', `El ejemplo no pasa las validaciones: ${buildErrors.join('; ')}`);
    return { lines, exitCode: 1 };
  }

  try {
    const existing = new Map((await deps.tables.list(actor.tenantId)).map((t) => [t.key, t]));
    let blocked = false;

    // (a) roles-adquisiciones: tabla + fila de ejemplo (nunca pisa lo que el administrador ya editó).
    const roles = existing.get(ROLES_TABLE.key);
    if (!roles) {
      if (dryRun) would(`crearía la tabla «${ROLES_TABLE.key}» con la fila de ejemplo «${ROL_EJECUTIVO_AYT}» → ${ROLES_EXAMPLE_ROW.signerId}`);
      else {
        const t = await deps.tables.create(ROLES_TABLE, actor);
        await deps.tables.createRow(t.id, { values: ROLES_EXAMPLE_ROW }, actor);
        add('creado', `Tabla «${ROLES_TABLE.key}» con la fila de ejemplo «${ROL_EJECUTIVO_AYT}» → ${ROLES_EXAMPLE_ROW.signerId} (EJEMPLO EDITABLE: cámbiala desde la pantalla de tablas).`);
      }
    } else {
      if (!roles.active) {
        add('error', `La tabla «${ROLES_TABLE.key}» existe pero está inactiva: actívala desde la pantalla de tablas.`);
        blocked = true;
      } else if (roles.rowCount === 0) {
        if (dryRun) would(`agregaría la fila de ejemplo a la tabla «${ROLES_TABLE.key}», que está vacía`);
        else {
          await deps.tables.createRow(roles.id, { values: ROLES_EXAMPLE_ROW }, actor);
          add('creado', `Fila de ejemplo «${ROL_EJECUTIVO_AYT}» en la tabla «${ROLES_TABLE.key}», que estaba vacía.`);
        }
      } else {
        add('existe', `Tabla «${ROLES_TABLE.key}» (${roles.rowCount} filas): no se toca.`);
      }
    }

    // (b) responsables-gasto: debe existir; si no, se crea vacía y se avisa que falta importar la matriz.
    const resp = existing.get(RESPONSABLES_TABLE.key);
    if (!resp) {
      if (dryRun) would(`crearía la tabla «${RESPONSABLES_TABLE.key}» vacía`);
      else {
        await deps.tables.create(RESPONSABLES_TABLE, actor);
        add('creado', `Tabla «${RESPONSABLES_TABLE.key}» vacía, con el esquema de la matriz.`);
      }
      add('pendiente', `Falta importar la matriz de responsables de gasto en «${RESPONSABLES_TABLE.key}» (pantalla de tablas → importar). Mientras tanto AUT_AREA, AUT_TIPO, T26 y T27 preguntan a quién enviar.`);
    } else if (!resp.active) {
      add('error', `La tabla «${RESPONSABLES_TABLE.key}» existe pero está inactiva: actívala desde la pantalla de tablas.`);
      blocked = true;
    } else if (resp.rowCount === 0) {
      add('existe', `Tabla «${RESPONSABLES_TABLE.key}»: no se toca.`);
      add('pendiente', `La tabla «${RESPONSABLES_TABLE.key}» no tiene filas: falta importar la matriz de responsables de gasto.`);
    } else {
      add('existe', `Tabla «${RESPONSABLES_TABLE.key}» (${resp.rowCount} filas): no se toca.`);
    }

    // (c) formato digital.
    if (blocked) {
      add('error', `No se crea el formato «${FORM_NAME}»: hay tablas inactivas (ver arriba).`);
      return { lines, exitCode: 1 };
    }
    const desired = exampleFormBody();
    const found = (await deps.templates.list(actor, true)).find((t) => t.name.toLowerCase() === FORM_NAME.toLowerCase());
    if (!found) {
      if (dryRun) {
        would(`crearía y publicaría el formato digital «${FORM_NAME}» (${desired.flow.variables.length} variables, ${desired.flow.steps.length} pasos, ${desired.attachmentSpecs.length} anexos)`);
      } else {
        const created = await deps.templates.createForm(desired, actor);
        await deps.templates.setPublished(created.id, true, actor);
        const saved = await deps.templates.get(created.id, actor);
        add('creado', `Formato digital «${FORM_NAME}» (${desired.flow.variables.length} variables, ${desired.flow.steps.length} pasos, ${desired.attachmentSpecs.length} anexos), publicado. ${methodsText(saved.methods)}`);
      }
    } else {
      const current = await deps.templates.get(found.id, actor);
      if (current.kind !== undefined && current.kind !== 'FORM') {
        add('error', `Ya existe un formato «${FORM_NAME}» con su propio PDF (no es digital): renómbralo o bórralo y vuelve a correr el script.`);
        return { lines, exitCode: 1 };
      }
      const diff = formDiff(current, desired);
      const estado = current.published ? 'publicado' : 'sin publicar';
      if (diff.length === 0) {
        add('existe', `Formato «${FORM_NAME}» (${estado}): sin cambios, no se toca. ${methodsText(current.methods)}`);
        if (!current.published) add('pendiente', `El formato «${FORM_NAME}» está sin publicar; publícalo desde la pantalla de formatos (o corre con --force).`);
      } else if (diff.every((item) => item === 'flujo asociado')) {
        if (dryRun) would(`asociaría el formato «${FORM_NAME}» con ${desired.flowKey} v${desired.flowVersion} sin cambiar su contenido`);
        else {
          await deps.templates.update(found.id, { flowKey: desired.flowKey, flowVersion: desired.flowVersion }, actor);
          add('creado', `Formato «${FORM_NAME}» asociado con ${desired.flowKey} v${desired.flowVersion}; el documento, campos, flujo y anexos se conservaron.`);
        }
      } else if (!force) {
        add('pendiente', `El formato «${FORM_NAME}» (${estado}) difiere de lo que arma este script (${diff.join(', ')}). No se sobrescribe; corre con --force para despublicarlo, regenerarlo y publicarlo de nuevo.`);
      } else if (dryRun) {
        would(`${current.published ? 'despublicaría, ' : ''}regeneraría y publicaría el formato «${FORM_NAME}» (cambió: ${diff.join(', ')})`);
      } else {
        if (current.published) await deps.templates.setPublished(current.id, false, actor);
        await deps.templates.createForm({ ...desired, id: current.id }, actor);
        await deps.templates.setPublished(current.id, true, actor);
        const saved = await deps.templates.get(current.id, actor);
        add('creado', `Formato «${FORM_NAME}» regenerado y publicado de nuevo (cambió: ${diff.join(', ')}). ${methodsText(saved.methods)}`);
      }
    }
  } catch (e) {
    add('error', describeError(e));
    return { lines, exitCode: 1 };
  }

  const exitCode = lines.some((l) => l.level === 'pendiente') ? 3 : 0;
  return { lines, exitCode };
}

export function formatReport(report: SeedReport, options: SeedOptions): string {
  const head = `Ejemplo «Solicitud de gastos / Adquisiciones» · tenant «${options.tenant}»${options.dryRun ? ' · DRY-RUN (no se escribió nada)' : ''}`;
  const tag: Record<Level, string> = { creado: 'CREADO   ', existe: 'YA EXISTÍA', pendiente: 'PENDIENTE', error: 'ERROR    ', 'dry-run': 'DRY-RUN  ' };
  return [head, ...report.lines.map((l) => `  [${tag[l.level]}] ${l.text}`)].join('\n');
}
