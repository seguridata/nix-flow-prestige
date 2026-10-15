/** Matriz de responsables de gasto: tipos, validación y CSV de importación (sin dependencias de UI). */
export type ExpenseStage = "area" | "tipoGasto";

export interface ExpenseResponsibleInput {
  area: string;
  expenseType: string | null;
  /** Concepto de gasto (p. ej. «Renta oficinas»). */
  concept: string | null;
  stage: ExpenseStage;
  minAmount: number | null;
  maxAmount: number | null;
  signerId: string;
  name: string;
  email: string;
  active: boolean;
}

export interface ExpenseResponsible extends ExpenseResponsibleInput {
  id: string;
}

export const STAGE_LABEL: Record<ExpenseStage, string> = {
  area: "Autorización por área",
  tipoGasto: "Autorización por tipo de gasto",
};

/** Columnas del CSV, en este orden. */
export const CSV_COLUMNS = ["etapa", "area", "tipoGasto", "concepto", "montoMin", "montoMax", "signerId", "nombre", "correo"] as const;
export const MAX_IMPORT_ROWS = 2000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

/** Campos del formulario o de una fila de CSV, ya como texto. */
export interface RawRow {
  stage: string;
  area: string;
  expenseType: string;
  concept: string;
  minAmount: string;
  maxAmount: string;
  signerId: string;
  name: string;
  email: string;
}

export function parseStage(v: string): ExpenseStage | null {
  const n = norm(v);
  if (n === "area") return "area";
  if (n === "tipogasto" || n === "tipodegasto") return "tipoGasto";
  return null;
}

/** Texto → número ≥ 0; vacío = null; inválido = NaN. Con `;` como separador la coma es decimal. */
export function parseAmount(v: string, decimalComma = false): number | null {
  let t = v.trim().replace(/[$\s]/g, "");
  if (t === "") return null;
  if (decimalComma) t = t.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Number(t);
}

/** Valida una fila y devuelve la fila lista para enviar, o los errores (en español, por campo). */
export function validateRow(raw: RawRow, decimalComma = false): { row?: ExpenseResponsibleInput; errors: string[] } {
  const errors: string[] = [];
  const stage = parseStage(raw.stage);
  if (!stage) errors.push("La etapa debe ser «area» o «tipoGasto».");
  const area = raw.area.trim();
  if (!area) errors.push("Falta el área.");
  const expenseType = raw.expenseType.trim();
  if (stage === "tipoGasto" && !expenseType) errors.push("Falta el tipo de gasto (obligatorio en la etapa tipoGasto).");
  const concept = raw.concept.trim();
  const min = parseAmount(raw.minAmount, decimalComma);
  const max = parseAmount(raw.maxAmount, decimalComma);
  if (Number.isNaN(min)) errors.push("El monto mínimo no es un número válido.");
  if (Number.isNaN(max)) errors.push("El monto máximo no es un número válido.");
  if (min !== null && max !== null && !Number.isNaN(min) && !Number.isNaN(max) && min > max)
    errors.push("El monto mínimo es mayor que el máximo.");
  const email = raw.email.trim();
  if (email && !EMAIL.test(email)) errors.push("El correo no es válido.");
  const signerId = raw.signerId.trim() || email;
  if (!signerId) errors.push("Falta el responsable (signerId o correo).");
  const name = raw.name.trim();
  if (!name) errors.push("Falta el nombre del responsable.");
  if (errors.length > 0) return { errors };
  return {
    errors,
    row: {
      stage: stage!,
      area,
      expenseType: expenseType || null,
      concept: concept || null,
      minAmount: min,
      maxAmount: max,
      signerId,
      name,
      email,
      active: true,
    },
  };
}

/** CSV → filas de celdas. Soporta comillas, comillas dobles escapadas, saltos dentro de comillas y BOM. */
export function parseCsv(text: string, delimiter: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cur = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  const src = text.replace(/^﻿/, "");
  const endRow = () => {
    cells.push(cur);
    cur = "";
    if (cells.some((c) => c.trim() !== "")) rows.push({ cells, line: startLine });
    cells = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cur += ch;
      }
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === delimiter) {
      cells.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      line++;
      startLine = line;
    } else cur += ch;
  }
  if (cur !== "" || cells.length > 0) endRow();
  return rows;
}

/** Separador de la cabecera: el que más aparezca entre `;` y `,` (coma si empatan). */
export function detectDelimiter(text: string): "," | ";" {
  const head = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const semi = (head.match(/;/g) ?? []).length;
  const comma = (head.match(/,/g) ?? []).length;
  return semi > comma ? ";" : ",";
}

export interface CsvError {
  /** Línea del archivo (1 = cabecera); 0 si el error es del archivo completo. */
  line: number;
  message: string;
}

export interface CsvParseResult {
  rows: ExpenseResponsibleInput[];
  errors: CsvError[];
}

const HEADER_KEYS: Record<(typeof CSV_COLUMNS)[number], string> = {
  etapa: "etapa",
  area: "area",
  tipoGasto: "tipogasto",
  concepto: "concepto",
  montoMin: "montomin",
  montoMax: "montomax",
  signerId: "signerid",
  nombre: "nombre",
  correo: "correo",
};

/** Lee y valida el CSV completo: si hay errores `rows` queda vacío y no se debe enviar nada. */
export function parseExpenseCsv(text: string): CsvParseResult {
  if (!text.trim()) return { rows: [], errors: [{ line: 0, message: "El archivo está vacío." }] };
  const delimiter = detectDelimiter(text);
  const table = parseCsv(text, delimiter);
  const header = table[0];
  if (!header) return { rows: [], errors: [{ line: 0, message: "El archivo está vacío." }] };

  const index = new Map<string, number>();
  header.cells.forEach((c, i) => index.set(norm(c), i));
  const missing = CSV_COLUMNS.filter((c) => !index.has(HEADER_KEYS[c]));
  if (missing.length > 0) {
    return { rows: [], errors: [{ line: header.line, message: `Faltan columnas en la cabecera: ${missing.join(", ")}.` }] };
  }
  const body = table.slice(1);
  if (body.length === 0) return { rows: [], errors: [{ line: 0, message: "El archivo no tiene filas de datos." }] };
  if (body.length > MAX_IMPORT_ROWS)
    return { rows: [], errors: [{ line: 0, message: `Demasiadas filas: el máximo por importación es ${MAX_IMPORT_ROWS}.` }] };

  const errors: CsvError[] = [];
  const rows: ExpenseResponsibleInput[] = [];
  for (const r of body) {
    const get = (c: (typeof CSV_COLUMNS)[number]) => r.cells[index.get(HEADER_KEYS[c])!] ?? "";
    const res = validateRow(
      {
        stage: get("etapa"),
        area: get("area"),
        expenseType: get("tipoGasto"),
        concept: get("concepto"),
        minAmount: get("montoMin"),
        maxAmount: get("montoMax"),
        signerId: get("signerId"),
        name: get("nombre"),
        email: get("correo"),
      },
      delimiter === ";",
    );
    if (res.row) rows.push(res.row);
    else for (const message of res.errors) errors.push({ line: r.line, message });
  }
  return { rows: errors.length > 0 ? [] : rows, errors };
}

/** Plantilla descargable: cabecera y dos ejemplos (uno por etapa). */
export const CSV_TEMPLATE =
  [
    CSV_COLUMNS.join(","),
    "area,Tecnología,,Renta oficinas,0,50000,ana.ruiz@empresa.com,Ana Ruiz,ana.ruiz@empresa.com",
    "tipoGasto,Tecnología,Licencias de software,,0,,luis.perez@empresa.com,Luis Pérez,luis.perez@empresa.com",
  ].join("\r\n") + "\r\n";
