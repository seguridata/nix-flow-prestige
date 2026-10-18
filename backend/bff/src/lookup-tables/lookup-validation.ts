import { COLUMN_KEY_RE, TABLE_KEY_RE, allVariables, flowQueries, isObj } from '../flow/flow';
import type { Flow, FlowValues, LookupQuery } from '../flow/flow.types';
import { opAllowedFor, parseDate, parseNumber, type ColumnType, type LookupColumn } from './lookup-engine';

export const MAX_COLUMNS = 30;
export const MAX_ROWS = 5000;
export const MAX_CELL_TEXT = 500;
export const MAX_OPTIONS = 200;
export const MAX_NUMBER = 1e13;
export const MAX_TEST_INPUTS = 50;

const COLUMN_TYPES: readonly ColumnType[] = ['text', 'number', 'date', 'select'];
const INPUT_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const ISO_DATE_STRICT = /^\d{4}-\d{2}-\d{2}$/;

export const isValidTableKey = (k: unknown): k is string => typeof k === 'string' && TABLE_KEY_RE.test(k);

/** Texto obligatorio u opcional con tope de largo; devuelve el texto recortado o null (y registra el error). */
export function cleanText(v: unknown, label: string, max: number, errors: string[], required: boolean): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (required) errors.push(`${label}: es obligatorio`);
    return null;
  }
  if (typeof v !== 'string') {
    errors.push(`${label}: debe ser texto`);
    return null;
  }
  const t = v.trim();
  if (t.length > max) {
    errors.push(`${label}: máximo ${max} caracteres`);
    return null;
  }
  return t;
}

/** Valida las columnas (máx. 30, claves únicas con la regla de las variables, `select` con opciones) y las devuelve con lista blanca. */
export function parseColumns(raw: unknown): { columns?: LookupColumn[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(raw) || raw.length === 0) return { errors: ['La tabla necesita al menos una columna'] };
  if (raw.length > MAX_COLUMNS) return { errors: [`Máximo ${MAX_COLUMNS} columnas por tabla`] };
  const seen = new Set<string>();
  const columns: LookupColumn[] = [];
  raw.forEach((c, i) => {
    const at = `Columna ${i + 1}`;
    if (!isObj(c)) return errors.push(`${at}: formato inválido`);
    const key = typeof c.key === 'string' ? c.key : '';
    if (!COLUMN_KEY_RE.test(key)) return errors.push(`${at}: la clave «${key}» debe empezar con letra y usar solo letras, números y guion bajo (máx. 40)`);
    if (seen.has(key)) return errors.push(`${at}: la clave «${key}» está repetida`);
    seen.add(key);
    const label = cleanText(c.label, `Columna «${key}», etiqueta`, 120, errors, true);
    if (!(COLUMN_TYPES as readonly unknown[]).includes(c.type)) return errors.push(`Columna «${key}»: el tipo debe ser text, number, date o select`);
    const type = c.type as ColumnType;
    let options: string[] | undefined;
    if (type === 'select') {
      const o = c.options;
      if (!Array.isArray(o) || o.length === 0 || o.length > MAX_OPTIONS || o.some((x) => typeof x !== 'string' || !x.trim() || x.length > 120)) {
        return errors.push(`Columna «${key}»: una lista de selección necesita de 1 a ${MAX_OPTIONS} opciones de texto`);
      }
      options = [...new Set((o as string[]).map((x) => x.trim()))];
    } else if (c.options !== undefined) {
      return errors.push(`Columna «${key}»: solo las columnas de selección llevan opciones`);
    }
    if (label) columns.push({ key, label, type, ...(options ? { options } : {}) });
  });
  return errors.length ? { errors } : { columns, errors };
}

export type CellValue = string | number;
export type RowValues = Record<string, CellValue>;

/**
 * Valida los valores de UNA fila contra las columnas: solo claves de columna, valores acordes al tipo. Las celdas vacías
 * (null, '' o ausentes) no se guardan. Devuelve los valores limpios.
 */
export function parseRowValues(raw: unknown, columns: readonly LookupColumn[], label: string): { values?: RowValues; errors: string[] } {
  if (!isObj(raw)) return { errors: [`${label}: los valores deben ser un objeto`] };
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const errors: string[] = [];
  const out: RowValues = {};
  for (const [key, v] of Object.entries(raw)) {
    const col = byKey.get(key);
    if (!col) {
      errors.push(`${label}: la columna «${key}» no existe en la tabla`);
      continue;
    }
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) continue;
    const at = `${label}, «${col.label}»`;
    switch (col.type) {
      case 'text': {
        const t = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
        if (typeof t !== 'string') errors.push(`${at}: debe ser texto`);
        else if (t.trim().length > MAX_CELL_TEXT) errors.push(`${at}: máximo ${MAX_CELL_TEXT} caracteres`);
        else out[key] = t.trim();
        break;
      }
      case 'number': {
        const n = parseNumber(v);
        if (n === null || Math.abs(n) > MAX_NUMBER) errors.push(`${at}: debe ser un número (hasta ${MAX_NUMBER})`);
        else out[key] = n;
        break;
      }
      case 'date':
        if (typeof v !== 'string' || !ISO_DATE_STRICT.test(v.trim()) || parseDate(v.trim()) === null) errors.push(`${at}: debe ser una fecha AAAA-MM-DD`);
        else out[key] = v.trim();
        break;
      case 'select':
        if (typeof v !== 'string' || !(col.options ?? []).includes(v.trim())) errors.push(`${at}: elige una de las opciones de la lista`);
        else out[key] = v.trim();
        break;
    }
  }
  return errors.length ? { errors } : { values: out, errors };
}

/** Valores de prueba (`inputs`) del dry-run: pocas claves, texto o número. */
export function parseInputs(raw: unknown): { inputs?: FlowValues; errors: string[] } {
  if (raw === undefined || raw === null) return { inputs: {}, errors: [] };
  if (!isObj(raw)) return { errors: ['inputs debe ser un objeto'] };
  const entries = Object.entries(raw);
  if (entries.length > MAX_TEST_INPUTS) return { errors: [`Máximo ${MAX_TEST_INPUTS} valores de prueba`] };
  const inputs: FlowValues = {};
  const errors: string[] = [];
  for (const [k, v] of entries) {
    if (!INPUT_KEY_RE.test(k)) errors.push(`inputs: la clave «${k}» no es válida`);
    else if (v === null || v === undefined) continue;
    else if (typeof v === 'number' && Number.isFinite(v)) inputs[k] = v;
    else if (typeof v === 'string' && v.length <= MAX_CELL_TEXT) inputs[k] = v;
    else errors.push(`inputs: «${k}» debe ser un texto (máx. ${MAX_CELL_TEXT}) o un número`);
  }
  return errors.length ? { errors } : { inputs, errors };
}

/**
 * Comprueba una consulta contra las columnas reales de la tabla: que existan y que el operador tenga sentido para su tipo.
 * `varTypes` (opcional) permite además cuidar que una variable numérica o de fecha se compare con una columna del mismo tipo.
 */
export function checkQueryAgainstColumns(
  query: LookupQuery,
  columns: readonly LookupColumn[],
  label: string,
  varTypes?: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];
  const byKey = new Map(columns.map((c) => [c.key, c]));
  query.match.forEach((c, i) => {
    const at = `${label}, condición ${i + 1}`;
    const col = byKey.get(c.column);
    if (!col) return errors.push(`${at}: la columna «${c.column}» no existe en la tabla «${query.table}»`);
    if (!opAllowedFor(c.op, col.type)) {
      return errors.push(`${at}: el operador «${c.op}» no aplica a la columna «${c.column}» (tipo ${col.type})`);
    }
    const src = c.source;
    if (src && 'var' in src && varTypes) {
      const vt = varTypes.get(src.var);
      if ((col.type === 'number' || col.type === 'date') && vt !== undefined && vt !== col.type) {
        errors.push(`${at}: «${src.var}» es de tipo ${vt} y la columna «${c.column}» de tipo ${col.type}`);
      }
    }
  });
  return errors;
}

/** Valida los participantes y variables derivadas de un flujo contra las tablas activas del tenant (clave → columnas). */
export function checkFlowAgainstTables(flow: Flow, tables: ReadonlyMap<string, readonly LookupColumn[]>): string[] {
  const errors: string[] = [];
  const varTypes = new Map(allVariables(flow).map((v) => [v.key, v.type as string]));
  varTypes.set('solicitante', 'text');
  for (const { where, query, columns } of flowQueries(flow)) {
    const cols = tables.get(query.table);
    if (!cols) {
      errors.push(`La ${where} usa la tabla «${query.table}», que no existe o no está activa`);
      continue;
    }
    errors.push(...checkQueryAgainstColumns(query, cols, `La ${where}`, varTypes));
    const keys = new Set(cols.map((c) => c.key));
    for (const c of columns) if (!keys.has(c)) errors.push(`La ${where} toma datos de la columna «${c}», que no existe en la tabla «${query.table}»`);
  }
  return errors;
}
