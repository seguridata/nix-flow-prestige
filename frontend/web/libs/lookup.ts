/**
 * Tablas de consulta (ADR-008): tipos que espeja el BFF, operadores, validación del esquema,
 * del constructor de condiciones y de las celdas, e importación desde CSV/TSV. Sin dependencias de UI.
 */
import { detectDelimiter, parseCsv, toCsv, type Delimiter } from "@/libs/csv";

export type LookupColumnType = "text" | "number" | "date" | "select";

export interface LookupColumn {
  key: string;
  label: string;
  type: LookupColumnType;
  options?: string[];
}

export type LookupOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "in"
  | "notIn"
  | "isEmpty"
  | "isNotEmpty";

export type LookupSource = { var: string } | { value: string | number };

export interface LookupCondition {
  column: string;
  op: LookupOp;
  /** Sin fuente solo para `isEmpty` / `isNotEmpty`. */
  source?: LookupSource;
  /** Por defecto `true`: una celda vacía en la fila cuenta como «cualquiera». */
  emptyMatchesAny?: boolean;
}

export interface LookupQuery {
  /** `key` de la tabla. */
  table: string;
  match: LookupCondition[];
}

/** Persona que resuelve un participante `lookup`: claves de COLUMNA de la tabla. */
export interface LookupPerson {
  signerId: string;
  name?: string;
  email?: string;
}

export type CellValue = string | number;

export interface LookupTableSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  columns: LookupColumn[];
  revision: number;
  active: boolean;
  rowCount: number;
}

export type LookupTable = LookupTableSummary;

export interface LookupRow {
  id: string;
  values: Record<string, CellValue | null | undefined>;
  position: number;
  active: boolean;
}

export const MAX_COLUMNS = 30;
export const MAX_ROWS = 5000;
export const MAX_CELL_LENGTH = 500;
/** Misma regla que las variables del flujo. */
export const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export const COLUMN_TYPE_LABEL: Record<LookupColumnType, string> = {
  text: "Texto",
  number: "Número",
  date: "Fecha",
  select: "Lista de opciones",
};

export const OP_ORDER: readonly LookupOp[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "in",
  "notIn",
  "isEmpty",
  "isNotEmpty",
];

/** Se leen «valor de la solicitud» OPERADOR «valor de la fila». */
export const LOOKUP_OP_LABEL: Record<LookupOp, string> = {
  eq: "es igual a",
  neq: "es diferente de",
  gt: "mayor que",
  gte: "mayor o igual que",
  lt: "menor que",
  lte: "menor o igual que",
  contains: "contiene",
  notContains: "no contiene",
  startsWith: "empieza con",
  endsWith: "termina con",
  in: "está en la lista",
  notIn: "no está en la lista",
  isEmpty: "está vacío",
  isNotEmpty: "no está vacío",
};

const COMPARISON: readonly LookupOp[] = ["gt", "gte", "lt", "lte"];
const TEXTUAL: readonly LookupOp[] = ["contains", "notContains", "startsWith", "endsWith"];

/** Operadores que admite cada tipo de columna (comparar es solo de números y fechas; buscar texto, solo de texto). */
export function opsForColumn(type: LookupColumnType): LookupOp[] {
  return OP_ORDER.filter((op) => {
    if (COMPARISON.includes(op)) return type === "number" || type === "date";
    if (TEXTUAL.includes(op)) return type === "text";
    return true;
  });
}

/** `isEmpty` / `isNotEmpty` no comparan con nada de la solicitud. */
export const opNeedsSource = (op: LookupOp): boolean => op !== "isEmpty" && op !== "isNotEmpty";

export const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

/** Clave de columna a partir de la etiqueta ("Monto máximo" → "monto_maximo"), cumpliendo KEY_RE. */
export function columnKeyFrom(label: string, taken: readonly string[] = []): string {
  let base = norm(label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  if (!base) base = "columna";
  if (!/^[a-z]/.test(base)) base = `c_${base}`;
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/* ───────── Esquema de columnas ───────── */

export function validateColumns(columns: readonly LookupColumn[]): string[] {
  const out: string[] = [];
  if (columns.length === 0) out.push("Agrega al menos una columna.");
  if (columns.length > MAX_COLUMNS) out.push(`Máximo ${MAX_COLUMNS} columnas.`);
  const seen = new Set<string>();
  columns.forEach((c, i) => {
    const name = c.label.trim() || `la columna ${i + 1}`;
    if (!c.label.trim()) out.push(`Pon nombre a la columna ${i + 1}.`);
    if (!KEY_RE.test(c.key)) out.push(`«${name}»: la clave debe empezar con letra y usar solo letras, números y guion bajo (máx. 40).`);
    if (seen.has(c.key)) out.push(`«${name}»: la clave «${c.key}» está repetida.`);
    seen.add(c.key);
    if (c.type === "select" && !(c.options ?? []).some((o) => o.trim())) out.push(`«${name}» necesita al menos una opción.`);
  });
  return out;
}

/** Texto del campo «opciones» (separadas por coma o salto de línea) → lista limpia y sin repetidos. */
export function parseOptions(text: string): string[] {
  const out: string[] = [];
  for (const o of text.split(/[,\n;]/)) {
    const t = o.trim();
    if (t && !out.some((x) => norm(x) === norm(t))) out.push(t);
  }
  return out;
}

/* ───────── Celdas ───────── */

/** Texto → número; vacío = null; inválido = NaN. Con `;` como separador la coma es decimal. */
export function parseNumber(v: string, decimalComma = false): number | null {
  let t = v.trim().replace(/[$\s]/g, "");
  if (t === "") return null;
  if (decimalComma) {
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "");
    t = t.replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Number(t);
}

function realDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** AAAA-MM-DD o DD/MM/AAAA → AAAA-MM-DD; vacío = null; inválido = undefined. */
export function parseDate(v: string): string | null | undefined {
  const t = v.trim();
  if (t === "") return null;
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else if ((hit = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t))) [d, m, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else return undefined;
  if (!realDate(y, m, d)) return undefined;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface ParsedCell {
  /** `null` = celda vacía. */
  value: CellValue | null;
  error?: string;
}

/** Valida y normaliza el texto de una celda según el tipo de su columna. */
export function parseCell(column: LookupColumn, raw: string, decimalComma = false): ParsedCell {
  const text = raw.trim();
  if (text === "") return { value: null };
  switch (column.type) {
    case "number": {
      const n = parseNumber(text, decimalComma);
      return Number.isNaN(n) ? { value: null, error: "no es un número válido" } : { value: n };
    }
    case "date": {
      const d = parseDate(text);
      return d === undefined ? { value: null, error: "no es una fecha válida (usa AAAA-MM-DD o DD/MM/AAAA)" } : { value: d };
    }
    case "select": {
      const hit = (column.options ?? []).find((o) => norm(o) === norm(text));
      return hit ? { value: hit } : { value: null, error: `«${text}» no está entre las opciones` };
    }
    default:
      return text.length > MAX_CELL_LENGTH
        ? { value: null, error: `pasa de ${MAX_CELL_LENGTH} caracteres` }
        : { value: text };
  }
}

/** Texto de cada celda de una fila → `values` listo para enviar (las celdas vacías no se envían). */
export function rowValuesFromTexts(
  columns: readonly LookupColumn[],
  texts: Readonly<Record<string, string>>,
  decimalComma = false,
): { values: Record<string, CellValue>; errors: { column: string; message: string }[] } {
  const values: Record<string, CellValue> = {};
  const errors: { column: string; message: string }[] = [];
  for (const c of columns) {
    const r = parseCell(c, texts[c.key] ?? "", decimalComma);
    if (r.error) errors.push({ column: c.key, message: `${c.label}: ${r.error}.` });
    else if (r.value !== null) values[c.key] = r.value;
  }
  return { values, errors };
}

export const cellText = (v: CellValue | null | undefined): string => (v === null || v === undefined ? "" : String(v));

/* ───────── Importación CSV / TSV ───────── */

export interface ImportError {
  /** Línea del archivo (1 = cabecera); 0 si el error es del archivo completo. */
  line: number;
  message: string;
}

export interface ImportParse {
  rows: Record<string, CellValue>[];
  errors: ImportError[];
  /** Columnas de la tabla que el archivo no trae: quedan vacías («cualquiera»). */
  missingColumns: string[];
  delimiter: Delimiter;
}

const fail = (message: string, delimiter: Delimiter = ","): ImportParse => ({
  rows: [],
  errors: [{ line: 0, message }],
  missingColumns: [],
  delimiter,
});

/**
 * Lee y valida TODO el archivo (o lo pegado desde Excel): si hay errores `rows` queda vacío y no se debe enviar nada.
 * La cabecera puede usar la clave o la etiqueta de cada columna.
 */
export function parseLookupImport(text: string, columns: readonly LookupColumn[]): ImportParse {
  if (!text.trim()) return fail("No hay nada que importar: el texto está vacío.");
  const delimiter = detectDelimiter(text);
  const table = parseCsv(text, delimiter);
  const header = table[0];
  if (!header) return fail("No hay nada que importar: el texto está vacío.", delimiter);

  const byName = new Map<string, LookupColumn>();
  for (const c of columns) {
    byName.set(norm(c.key), c);
    byName.set(norm(c.label), c);
  }
  const errors: ImportError[] = [];
  const colAt: (LookupColumn | null)[] = [];
  const used = new Set<string>();
  header.cells.forEach((h, i) => {
    const col = byName.get(norm(h));
    if (!col) {
      errors.push({ line: header.line, message: `La columna «${h.trim() || i + 1}» de la cabecera no existe en la tabla.` });
      colAt.push(null);
      return;
    }
    if (used.has(col.key)) errors.push({ line: header.line, message: `La columna «${col.label}» aparece más de una vez en la cabecera.` });
    used.add(col.key);
    colAt.push(col);
  });
  if (used.size === 0) {
    return { rows: [], errors: [{ line: header.line, message: "La primera fila debe ser la cabecera con los nombres de las columnas." }, ...errors], missingColumns: [], delimiter };
  }
  const missingColumns = columns.filter((c) => !used.has(c.key)).map((c) => c.label);

  const body = table.slice(1);
  if (body.length === 0) errors.push({ line: 0, message: "El archivo no tiene filas de datos." });
  if (body.length > MAX_ROWS) errors.push({ line: 0, message: `Demasiadas filas: el máximo por tabla es ${MAX_ROWS}.` });

  const rows: Record<string, CellValue>[] = [];
  // Con `;` (Excel en español) la coma es separador decimal.
  const decimalComma = delimiter === ";";
  for (const r of body) {
    if (r.cells.length > colAt.length && r.cells.slice(colAt.length).some((c) => c.trim() !== "")) {
      errors.push({ line: r.line, message: `La fila trae ${r.cells.length} celdas y la cabecera ${colAt.length}. ¿Un texto con el separador sin comillas?` });
      continue;
    }
    const values: Record<string, CellValue> = {};
    colAt.forEach((col, i) => {
      if (!col) return;
      const cell = parseCell(col, r.cells[i] ?? "", decimalComma);
      if (cell.error) errors.push({ line: r.line, message: `${col.label}: ${cell.error}.` });
      else if (cell.value !== null) values[col.key] = cell.value;
    });
    rows.push(values);
  }
  return { rows: errors.length > 0 ? [] : rows, errors, missingColumns, delimiter };
}

/** Plantilla descargable: cabecera con las claves y una fila de ejemplo por tipo de columna. */
export function lookupCsvTemplate(columns: readonly LookupColumn[]): string {
  const example = (c: LookupColumn) =>
    c.type === "number" ? "0" : c.type === "date" ? "2026-01-31" : c.type === "select" ? (c.options?.[0] ?? "") : "Ejemplo";
  return toCsv([columns.map((c) => c.key), columns.map(example)]);
}

/* ───────── Constructor de condiciones ───────── */

export interface SourceVar {
  key: string;
  label: string;
}

export interface QueryContext {
  /** Tabla ya cargada; sin ella solo se valida lo que no depende de las columnas. */
  table?: Pick<LookupTable, "columns" | "active" | "name"> | null;
  /** Variables del formulario (y calculadas) que pueden ser fuente de una condición. */
  sources: readonly SourceVar[];
  /** Prefijo de los mensajes, p. ej. «Paso 2». */
  where: string;
}

const conditionText = (c: LookupCondition) => c.column || "sin columna";

/** Errores del constructor de condiciones; los mismos que rechazaría el BFF al guardar. */
export function queryProblems(query: LookupQuery, ctx: QueryContext): string[] {
  const out: string[] = [];
  const p = (m: string) => out.push(`${ctx.where}: ${m}`);
  if (!query.table.trim()) {
    p("elige la tabla de consulta.");
    return out;
  }
  if (ctx.table && !ctx.table.active) p(`la tabla «${ctx.table.name}» está desactivada.`);
  if (query.match.length === 0) p("agrega al menos una condición para consultar la tabla.");
  query.match.forEach((c, i) => {
    const n = `condición ${i + 1}`;
    const col = ctx.table?.columns.find((x) => x.key === c.column);
    if (!c.column) return p(`${n}: elige la columna.`);
    if (ctx.table && !col) return p(`${n}: la columna «${conditionText(c)}» ya no existe en la tabla.`);
    if (col && !opsForColumn(col.type).includes(c.op)) p(`${n}: «${LOOKUP_OP_LABEL[c.op]}» no se puede usar con la columna «${col.label}».`);
    if (!opNeedsSource(c.op)) return;
    if (!c.source) return p(`${n}: elige con qué se compara (un dato del formulario o un valor fijo).`);
    if ("var" in c.source) {
      if (!c.source.var) p(`${n}: elige el dato del formulario.`);
      else if (!ctx.sources.some((s) => s.key === (c.source as { var: string }).var)) p(`${n}: el dato usado ya no existe.`);
    } else if (String(c.source.value).trim() === "") p(`${n}: falta el valor fijo.`);
    else if (col?.type === "number" && Number.isNaN(Number(c.source.value))) p(`${n}: el valor fijo debe ser un número.`);
  });
  return out;
}

/** «Área es igual a Departamento» — «valor de la solicitud» OPERADOR «columna de la tabla». */
export function describeCondition(
  c: LookupCondition,
  columns: readonly LookupColumn[] = [],
  sources: readonly SourceVar[] = [],
): string {
  const col = columns.find((x) => x.key === c.column)?.label ?? c.column;
  if (!opNeedsSource(c.op)) return `${col} ${LOOKUP_OP_LABEL[c.op]}`;
  const src = !c.source
    ? "…"
    : "var" in c.source
      ? (sources.find((s) => s.key === (c.source as { var: string }).var)?.label ?? c.source.var)
      : `«${c.source.value}»`;
  return `${src} ${LOOKUP_OP_LABEL[c.op]} ${col}`;
}

export function describeQuery(query: LookupQuery, columns?: readonly LookupColumn[], sources?: readonly SourceVar[]): string {
  if (query.match.length === 0) return "la primera fila";
  return query.match.map((c) => describeCondition(c, columns, sources)).join(" y ");
}

/* ───────── Probar consulta ───────── */

export interface LookupTestMatch {
  rowId: string;
  position: number;
  /** Lugar en el orden de evaluación de toda la tabla, desde 1 (lo calcula el BFF). */
  order?: number;
  values: Record<string, CellValue | null | undefined>;
}

export interface LookupTestResult {
  matches: LookupTestMatch[];
  first: LookupTestMatch | null;
  /** Por fila: dónde dejó de coincidir (índice de condición desde 0, o clave de columna); sin `failedAt` coincide. */
  explain: { rowId: string; order?: number; failedAt?: number | string }[];
}

/** Qué condición falló, en español, a partir de lo que devuelve /test (índice o clave de columna). */
export function describeFailure(
  failedAt: number | string | undefined,
  query: LookupQuery,
  columns: readonly LookupColumn[],
): string {
  if (failedAt === undefined) return "Coincide";
  const idx = typeof failedAt === "number" ? failedAt : query.match.findIndex((c) => c.column === failedAt);
  const cond = query.match[idx];
  if (cond) return `No cumple la condición ${idx + 1}: ${describeCondition(cond, columns)}`;
  const col = columns.find((c) => c.key === failedAt)?.label ?? String(failedAt);
  return `No cumple en la columna «${col}»`;
}

/** Propone qué columnas traen a la persona según su nombre (el administrador puede corregirlas). */
export function guessPersonColumns(columns: readonly LookupColumn[]): LookupPerson {
  const find = (re: RegExp) => columns.find((c) => re.test(norm(c.key)) || re.test(norm(c.label)))?.key;
  const email = find(/correo|email|mail/);
  const name = find(/nombre|name|responsable|persona/);
  const signerId = find(/signer|identificador|^id$/) ?? email ?? "";
  return { signerId, name: name && name !== signerId ? name : undefined, email };
}

/* ───────── Filas por páginas (ADR-008 §6) ───────── */

/** El BFF acepta de 1 a 200 filas por página; más que eso responde 400. */
export const MAX_PAGE_LIMIT = 200;
/** Filas por página en la cuadrícula: solo se pinta lo cargado. */
export const ROWS_PAGE_SIZE = 50;

export const clampPageLimit = (n: number | undefined, fallback = ROWS_PAGE_SIZE): number =>
  Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(n ?? fallback) || fallback));

export type ActiveFilter = "all" | "active" | "inactive";

export interface RowsFilters {
  q: string;
  active: ActiveFilter;
}

export const NO_FILTERS: RowsFilters = { q: "", active: "all" };
export const isFiltering = (f: RowsFilters): boolean => f.q.trim() !== "" || f.active !== "all";

export interface RowsPage {
  items: LookupRow[];
  nextCursor: string | null;
  /** Filas que cumplen los filtros en TODA la tabla, no solo en la página. */
  total: number;
}

/** Forma de `useInfiniteQuery` (`InfiniteData`), sin depender de la librería. */
export interface RowsData {
  pages: RowsPage[];
  pageParams: unknown[];
}

export interface RowsQuery extends Partial<RowsFilters> {
  cursor?: string | null;
  limit?: number;
}

/** Query string de `GET /lookup-tables/:id/rows`: el límite nunca pasa de 200 y los filtros vacíos no se mandan. */
export function rowsQueryString(o: RowsQuery = {}): string {
  const p = new URLSearchParams();
  if (o.cursor) p.set("cursor", o.cursor);
  p.set("limit", String(clampPageLimit(o.limit)));
  if (o.q?.trim()) p.set("q", o.q.trim());
  if (o.active === "active") p.set("active", "true");
  if (o.active === "inactive") p.set("active", "false");
  return p.toString();
}

/** Respuesta de `POST …/rows/:rowId/move`. */
export interface MoveResult {
  id: string;
  moved: boolean;
  /** Lugar de la fila en el orden de evaluación de TODA la tabla, desde 1. */
  index: number;
  position: number;
  total: number;
  revision: number;
  changed: { id: string; position: number }[];
}

export type MoveBody = { direction: "up" | "down" } | { toTop: true } | { afterRowId: string | null };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Orden de evaluación del servidor: `position` y, a igualdad, `id`. */
export const byOrder = (a: LookupRow, b: LookupRow): number => a.position - b.position || cmp(a.id, b.id);

/** Cursor del BFF: `position:id` de la última fila. */
export const rowCursor = (r: LookupRow): string => `${r.position}:${r.id}`;

/** Todas las filas cargadas, sin repetidos (si una fila llegó en dos páginas gana la más reciente). */
export function flattenRows(pages: readonly RowsPage[]): LookupRow[] {
  const byId = new Map<string, LookupRow>();
  for (const p of pages) for (const r of p.items) byId.set(r.id, r);
  return [...byId.values()];
}

/** ¿Quedan filas por cargar? */
export const hasMoreRows = (data: RowsData | undefined): boolean => (data?.pages[data.pages.length - 1]?.nextCursor ?? null) !== null;
export const rowsTotal = (data: RowsData | undefined): number => data?.pages[data.pages.length - 1]?.total ?? 0;

/** Filas que faltan por cargar según el total. */
export const rowsRemaining = (data: RowsData | undefined): number => (data ? Math.max(0, rowsTotal(data) - flattenRows(data.pages).length) : 0);

/**
 * Vuelve a repartir `rows` en las mismas páginas que tenía `data` (la última absorbe el resto), actualiza `total` y deja
 * los cursores coherentes con la última fila de cada página. Es lo que permite mover/borrar/agregar sin recargar.
 */
export function reflowRows(data: RowsData, rows: readonly LookupRow[], total: number): RowsData {
  const hasMore = hasMoreRows(data);
  const lens = data.pages.map((p) => p.items.length);
  const chunks: LookupRow[][] = [];
  let at = 0;
  lens.forEach((len, i) => {
    const last = i === lens.length - 1;
    const items = last ? rows.slice(at) : rows.slice(at, at + len);
    at += len;
    if (items.length > 0 || (last && chunks.length === 0)) chunks.push(items);
  });
  const pages = chunks.map((items, i) => ({
    items,
    total,
    nextCursor: items.length > 0 && (i < chunks.length - 1 || hasMore) ? rowCursor(items[items.length - 1]!) : null,
  }));
  return { pages, pageParams: data.pageParams.slice(0, pages.length) };
}

/**
 * Aplica el resultado de un `move` a lo cargado. Devuelve `null` si el movimiento tocó filas que aún no se cargaron
 * (p. ej. bajar la última fila cargada): entonces hay que recargar.
 */
export function rowsAfterMove(data: RowsData, res: MoveResult): RowsData | null {
  if (!res.moved) return data;
  const rows = flattenRows(data.pages);
  const loaded = new Set(rows.map((r) => r.id));
  if (!res.changed.every((c) => loaded.has(c.id))) return null;
  const pos = new Map(res.changed.map((c) => [c.id, c.position]));
  const next = rows.map((r) => (pos.has(r.id) ? { ...r, position: pos.get(r.id)! } : r)).sort(byOrder);
  return reflowRows(data, next, rowsTotal(data));
}

export function rowsAfterRemove(data: RowsData, rowId: string): RowsData {
  const rows = flattenRows(data.pages);
  const next = rows.filter((r) => r.id !== rowId);
  return reflowRows(data, next, next.length === rows.length ? rowsTotal(data) : Math.max(0, rowsTotal(data) - 1));
}

/** ¿La fila cumple los filtros activos? (misma idea que el servidor: texto sin mayúsculas ni acentos en cualquier celda). */
export function rowMatchesFilters(row: LookupRow, filters: RowsFilters): boolean {
  if (filters.active === "active" && !row.active) return false;
  if (filters.active === "inactive" && row.active) return false;
  const q = norm(filters.q);
  if (!q) return true;
  return Object.values(row.values).some((v) => norm(cellText(v)).includes(q));
}

/** Una fila guardada reemplaza a la cargada; si con el filtro de estado ya no cumple, sale de la lista. */
export function rowsAfterUpdate(data: RowsData, saved: LookupRow, filters: RowsFilters): { data: RowsData; removed: boolean } {
  const rows = flattenRows(data.pages);
  if (!rows.some((r) => r.id === saved.id)) return { data, removed: false };
  const stillShown = filters.active === "all" || (filters.active === "active") === saved.active;
  const next = rows.flatMap((r) => (r.id !== saved.id ? [r] : stillShown ? [{ ...r, ...saved }] : []));
  return { data: reflowRows(data, next, stillShown ? rowsTotal(data) : Math.max(0, rowsTotal(data) - 1)), removed: !stillShown };
}

/**
 * Una fila nueva va al final de la tabla: si ya está todo cargado se agrega ahí; si no, solo sube el total y se verá con
 * «Cargar más». Si no cumple los filtros activos no cambia nada.
 */
export function rowsAfterAdd(data: RowsData, row: LookupRow, filters: RowsFilters): RowsData {
  if (!rowMatchesFilters(row, filters)) return data;
  const rows = flattenRows(data.pages);
  const total = rowsTotal(data) + 1;
  if (hasMoreRows(data)) return reflowRows(data, rows, total);
  return reflowRows(data, [...rows.filter((r) => r.id !== row.id), row].sort(byOrder), total);
}

/* ───────── Exportación CSV ───────── */

/** Una celda de texto que empezara con `=`, `+`, `-` o `@` la tomaría Excel como fórmula: se antepone una comilla. */
const FORMULA = /^[=+\-@\t\r]/;

/** CSV con la cabecera de claves (la misma de la plantilla) y las filas en orden de evaluación. */
export function lookupRowsCsv(columns: readonly LookupColumn[], rows: readonly LookupRow[]): string {
  const cell = (c: LookupColumn, v: CellValue | null | undefined): string => {
    const t = cellText(v);
    return c.type !== "number" && FORMULA.test(t) ? `'${t}` : t;
  };
  return toCsv([columns.map((c) => c.key), ...rows.map((r) => columns.map((c) => cell(c, r.values[c.key])))]);
}
