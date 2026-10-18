import type { FlowValues, LookupCondition, LookupOp, LookupQuery } from '../flow/flow.types';

/**
 * Motor de evaluación de las tablas de consulta (ADR-008 §3 y §4). PURO: sin base de datos, sin reloj, sin estado.
 * Quien lo llama ya acotó la tabla y sus filas al tenant.
 *
 * Una condición se lee «valor de la solicitud» OPERADOR «valor de la fila»:
 *  - `gt/gte/lt/lte`: solicitud > / ≥ / < / ≤ fila (solo números y fechas);
 *  - `contains`: el valor de la solicitud CONTIENE el texto de la fila; `startsWith` / `endsWith` igual (solo texto);
 *  - `in` / `notIn`: el valor de la solicitud está / no está en la lista de la celda (separada por `;` o `,`);
 *  - `isEmpty` / `isNotEmpty`: la celda de la fila está / no está vacía (no usan fuente).
 * Una celda vacía cumple cualquier otra condición (`emptyMatchesAny`, por defecto verdadero). Si la solicitud no trae valor
 * y la celda sí, la condición NO se cumple (un dato que no se sabe no autoriza a nadie). Gana la primera fila activa por `position`.
 */

export type ColumnType = 'text' | 'number' | 'date' | 'select';

export interface LookupColumn {
  key: string;
  label: string;
  type: ColumnType;
  options?: string[];
}

export interface EngineRow {
  id: string;
  position: number;
  active: boolean;
  values: Record<string, unknown>;
}

export interface EngineTable {
  key: string;
  revision: number;
  columns: LookupColumn[];
  rows: EngineRow[];
}

export interface ConditionCheck {
  /** Posición (0 = primera) de la condición en la consulta. */
  index: number;
  column: string;
  op: LookupOp;
  ok: boolean;
  /** Por qué se cumplió o no, en español. */
  reason: string;
}

export interface RowEvaluation {
  matched: boolean;
  /** Condiciones evaluadas: todas si coincide; hasta la primera que falla si no. */
  checks: ConditionCheck[];
  failedAt?: ConditionCheck;
}

export interface LookupMatch {
  rowId: string;
  position: number;
  values: Record<string, unknown>;
}

export interface LookupResult {
  /** Primera fila que coincide, o null. */
  hit: (LookupMatch & { tableKey: string; revision: number }) | null;
  revision: number;
  /** Filas activas evaluadas hasta encontrar la coincidencia. */
  evaluated: number;
  /** Condiciones de la fila ganadora (vacío si no hubo coincidencia). */
  trace: ConditionCheck[];
}

export const OP_LABELS: Record<LookupOp, string> = {
  eq: 'es igual a',
  neq: 'es diferente de',
  gt: 'es mayor que',
  gte: 'es mayor o igual que',
  lt: 'es menor que',
  lte: 'es menor o igual que',
  contains: 'contiene',
  notContains: 'no contiene',
  startsWith: 'empieza con',
  endsWith: 'termina con',
  in: 'está en la lista',
  notIn: 'no está en la lista',
  isEmpty: 'está vacío',
  isNotEmpty: 'no está vacío',
};

/** Operadores que solo tienen sentido con números o fechas. */
export const ORDERED_LOOKUP_OPS: readonly LookupOp[] = ['gt', 'gte', 'lt', 'lte'];
/** Operadores que solo tienen sentido con texto. */
export const TEXT_LOOKUP_OPS: readonly LookupOp[] = ['contains', 'notContains', 'startsWith', 'endsWith'];

/** ¿Este operador se puede usar con una columna de este tipo? */
export function opAllowedFor(op: LookupOp, type: ColumnType): boolean {
  if (ORDERED_LOOKUP_OPS.includes(op)) return type === 'number' || type === 'date';
  if (TEXT_LOOKUP_OPS.includes(op)) return type === 'text' || type === 'select';
  return true;
}

// ───────────────────────────── normalización ─────────────────────────────

/** Texto sin mayúsculas, sin acentos y con los espacios colapsados. */
export function normText(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const isEmptyValue = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Fecha ISO (`AAAA-MM-DD`, con o sin hora) real y normalizada a `AAAA-MM-DD`; null si no lo es. */
export function parseDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Lista de una celda `in` / `notIn`: separada por `;` o `,`, sin elementos vacíos. */
export function parseList(cell: unknown): string[] {
  return String(cell ?? '')
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

// ───────────────────────────── una condición ─────────────────────────────

const show = (v: unknown) => (typeof v === 'string' ? `«${v}»` : String(v));

function requestValue(c: LookupCondition, inputs: FlowValues): string | number | null {
  const src = c.source;
  if (!src) return null;
  const raw = 'var' in src ? inputs[src.var] : src.value;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  return raw;
}

/** Evalúa UNA condición contra UNA fila. Nunca lanza. */
export function evaluateCondition(
  c: LookupCondition,
  index: number,
  row: Pick<EngineRow, 'values'>,
  columns: ReadonlyMap<string, LookupColumn>,
  inputs: FlowValues,
): ConditionCheck {
  const done = (ok: boolean, reason: string): ConditionCheck => ({ index, column: c.column, op: c.op, ok, reason });
  const col = columns.get(c.column);
  if (!col) return done(false, `la columna «${c.column}» no existe en la tabla`);
  const cell = row.values[c.column];
  const empty = isEmptyValue(cell);

  if (c.op === 'isEmpty') return done(empty, empty ? 'la celda está vacía' : 'la celda tiene valor');
  if (c.op === 'isNotEmpty') return done(!empty, empty ? 'la celda está vacía' : 'la celda tiene valor');

  if (empty) {
    return c.emptyMatchesAny === false
      ? done(false, 'la celda está vacía y la condición no admite «cualquiera»')
      : done(true, 'la celda está vacía: vale para cualquier valor');
  }

  const req = requestValue(c, inputs);
  if (req === null) return done(false, 'la solicitud no trae valor para comparar');

  const verb = OP_LABELS[c.op];
  const msg = (ok: boolean) => `${show(req)} ${ok ? '' : 'no '}${verb} ${show(cell)}`;

  if (ORDERED_LOOKUP_OPS.includes(c.op)) {
    if (col.type !== 'number' && col.type !== 'date') return done(false, `«${verb}» solo aplica a columnas de número o fecha`);
    const [a, b] = col.type === 'number' ? [parseNumber(req), parseNumber(cell)] : [parseDate(req), parseDate(cell)];
    if (a === null) return done(false, `el valor de la solicitud ${show(req)} no es ${col.type === 'number' ? 'un número' : 'una fecha AAAA-MM-DD'}`);
    if (b === null) return done(false, `el valor de la fila ${show(cell)} no es ${col.type === 'number' ? 'un número' : 'una fecha AAAA-MM-DD'}`);
    const ok = c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : a <= b;
    return done(ok, msg(ok));
  }

  if (TEXT_LOOKUP_OPS.includes(c.op)) {
    if (col.type !== 'text' && col.type !== 'select') return done(false, `«${verb}» solo aplica a columnas de texto`);
    const r = normText(req);
    const t = normText(cell);
    const ok =
      c.op === 'contains' ? r.includes(t) : c.op === 'notContains' ? !r.includes(t) : c.op === 'startsWith' ? r.startsWith(t) : r.endsWith(t);
    return done(ok, msg(ok));
  }

  // eq, neq, in, notIn: texto sin mayúsculas ni acentos; números y fechas por valor.
  const key = (v: unknown): string | null =>
    col.type === 'number'
      ? (() => { const n = parseNumber(v); return n === null ? null : String(n); })()
      : col.type === 'date'
        ? parseDate(v)
        : normText(v);
  const r = key(req);
  if (r === null) return done(false, `el valor de la solicitud ${show(req)} no es ${col.type === 'number' ? 'un número' : 'una fecha AAAA-MM-DD'}`);

  if (c.op === 'eq' || c.op === 'neq') {
    const t = key(cell);
    if (t === null) return done(false, `el valor de la fila ${show(cell)} no es ${col.type === 'number' ? 'un número' : 'una fecha AAAA-MM-DD'}`);
    const same = r === t;
    const ok = c.op === 'eq' ? same : !same;
    return done(ok, msg(ok));
  }

  // in / notIn
  const items = new Set(parseList(cell).map(key).filter((x): x is string => x !== null));
  const inside = items.has(r);
  const ok = c.op === 'in' ? inside : !inside;
  return done(ok, msg(ok));
}

// ───────────────────────────── una fila y una tabla ─────────────────────────────

export const columnMap = (columns: readonly LookupColumn[]): Map<string, LookupColumn> => new Map(columns.map((c) => [c.key, c]));

/** Evalúa todas las condiciones (unidas con AND) contra una fila; se detiene en la primera que falla. */
export function evaluateRow(
  row: Pick<EngineRow, 'values'>,
  conditions: readonly LookupCondition[],
  columns: ReadonlyMap<string, LookupColumn>,
  inputs: FlowValues,
): RowEvaluation {
  const checks: ConditionCheck[] = [];
  for (let i = 0; i < conditions.length; i++) {
    const check = evaluateCondition(conditions[i]!, i, row, columns, inputs);
    checks.push(check);
    if (!check.ok) return { matched: false, checks, failedAt: check };
  }
  return { matched: true, checks };
}

/** Filas activas en orden de evaluación: por `position` y, a igualdad, por id (determinista). */
export function orderedActiveRows(rows: readonly EngineRow[]): EngineRow[] {
  return rows.filter((r) => r.active).sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Primera fila activa que cumple todas las condiciones. Devuelve la fila, su id, la revisión de la tabla y la traza. */
export function runLookup(table: EngineTable, query: LookupQuery, inputs: FlowValues): LookupResult {
  const columns = columnMap(table.columns);
  let evaluated = 0;
  for (const row of orderedActiveRows(table.rows)) {
    evaluated++;
    const ev = evaluateRow(row, query.match, columns, inputs);
    if (ev.matched) {
      return {
        hit: { rowId: row.id, position: row.position, values: row.values, tableKey: table.key, revision: table.revision },
        revision: table.revision,
        evaluated,
        trace: ev.checks,
      };
    }
  }
  return { hit: null, revision: table.revision, evaluated, trace: [] };
}

export interface DryRunResult {
  revision: number;
  matches: LookupMatch[];
  first: LookupMatch | null;
  /** Una entrada por fila activa evaluada, en orden: si coincide o en qué condición falló. */
  explain: { rowId: string; position: number; matched: boolean; failedAt?: ConditionCheck }[];
  /** true si hubo más filas o coincidencias que los topes. */
  truncated: boolean;
  /** Filas inactivas, que el motor ignora. */
  ignoredInactive: number;
}

export const DRY_RUN_MAX_EXPLAIN = 500;
export const DRY_RUN_MAX_MATCHES = 50;

/** Como `runLookup`, pero recorre todas las filas y explica por qué cada una coincide o falla (para el administrador). */
export function dryRun(table: EngineTable, query: LookupQuery, inputs: FlowValues): DryRunResult {
  const columns = columnMap(table.columns);
  const active = orderedActiveRows(table.rows);
  const matches: LookupMatch[] = [];
  const explain: DryRunResult['explain'] = [];
  let truncated = false;
  let first: LookupMatch | null = null;
  for (const row of active) {
    const ev = evaluateRow(row, query.match, columns, inputs);
    const match: LookupMatch = { rowId: row.id, position: row.position, values: row.values };
    if (ev.matched) {
      first ??= match;
      if (matches.length < DRY_RUN_MAX_MATCHES) matches.push(match);
      else truncated = true;
    }
    if (explain.length < DRY_RUN_MAX_EXPLAIN) {
      explain.push({ rowId: row.id, position: row.position, matched: ev.matched, ...(ev.failedAt ? { failedAt: ev.failedAt } : {}) });
    } else truncated = true;
  }
  return { revision: table.revision, matches, first, explain, truncated, ignoredInactive: table.rows.length - active.length };
}
