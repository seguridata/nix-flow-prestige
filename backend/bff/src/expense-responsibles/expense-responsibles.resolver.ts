import { BadRequestException } from '@nestjs/common';

/** Etapas de la matriz. Las mismas que `Who.matrix.stage` del flujo. */
export const EXPENSE_STAGES = ['area', 'tipoGasto'] as const;
export type ExpenseStage = (typeof EXPENSE_STAGES)[number];

/** En `area` significa «cualquier área» (p. ej. un responsable por tipo de gasto que aplica a toda la empresa). */
export const ANY_AREA = '*';

export const MAX_IMPORT_ROWS = 500;
const MAX_AMOUNT = 1e13;

/** Fila de la matriz tal como la ve el contrato (montos como número). */
export interface ExpenseRow {
  id: string;
  area: string;
  expenseType: string | null;
  /** Concepto de gasto (p. ej. «Renta oficinas»); null = cualquiera. */
  concept: string | null;
  stage: ExpenseStage;
  minAmount: number | null;
  maxAmount: number | null;
  signerId: string;
  name: string | null;
  email: string | null;
  active: boolean;
}

export interface Match {
  signerId: string;
  name: string | null;
  email: string | null;
}

/** Lo que la regla necesita de una fila; sirve también para filas de Prisma ya convertidas. */
export type Candidate = Pick<ExpenseRow, 'id' | 'area' | 'expenseType' | 'concept' | 'stage' | 'minAmount' | 'maxAmount' | 'signerId' | 'name' | 'email' | 'active'>;

const norm = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('es');

/**
 * Regla de resolución (solo sobre filas YA acotadas al tenant por quien llama):
 *  - activas y de la etapa pedida;
 *  - el área de la fila coincide (o es «*»); si la fila trae tipo de gasto y/o concepto, también deben coincidir (null = cualquiera);
 *  - el monto cae en [min, max] (min null = 0, max null = sin tope);
 *  - gana la más específica (concepto > tipo de gasto > área concreta) y, a igualdad, la de menor tope; luego la de mayor piso.
 */
export function pickResponsible(
  rows: Candidate[],
  q: { stage: ExpenseStage; area?: string | null; expenseType?: string | null; concept?: string | null; amount?: number | null },
): Match | null {
  const area = norm(q.area);
  const type = norm(q.expenseType);
  const concept = norm(q.concept);
  const amount = typeof q.amount === 'number' && Number.isFinite(q.amount) ? q.amount : 0;

  const scored: { row: Candidate; specificity: number }[] = [];
  for (const row of rows) {
    if (!row.active || row.stage !== q.stage) continue;
    const rowArea = norm(row.area);
    const anyArea = rowArea === ANY_AREA;
    if (!anyArea && rowArea !== area) continue;
    const rowType = row.expenseType === null ? null : norm(row.expenseType);
    if (rowType !== null && rowType !== type) continue;
    const rowConcept = row.concept === null ? null : norm(row.concept);
    if (rowConcept !== null && rowConcept !== concept) continue;
    if (amount < (row.minAmount ?? 0)) continue;
    if (row.maxAmount !== null && amount > row.maxAmount) continue;
    scored.push({ row, specificity: (anyArea ? 0 : 1) + (rowType === null ? 0 : 2) + (rowConcept === null ? 0 : 4) });
  }
  if (!scored.length) return null;
  scored.sort(
    (a, b) =>
      b.specificity - a.specificity ||
      (a.row.maxAmount ?? Infinity) - (b.row.maxAmount ?? Infinity) ||
      (b.row.minAmount ?? 0) - (a.row.minAmount ?? 0) ||
      a.row.id.localeCompare(b.row.id),
  );
  const { signerId, name, email } = scored[0]!.row;
  return { signerId, name, email };
}

export interface RowInput {
  area: string;
  expenseType: string | null;
  concept: string | null;
  stage: ExpenseStage;
  minAmount: number | null;
  maxAmount: number | null;
  signerId: string;
  name: string | null;
  email: string | null;
  active: boolean;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, label: string, max: number, errors: string[], required: boolean): string | null {
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

function amount(v: unknown, label: string, errors: string[]): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) {
    errors.push(`${label}: debe ser un número entre 0 y ${MAX_AMOUNT}`);
    return null;
  }
  return Math.round(n * 100) / 100;
}

/** Validación estricta de UNA fila (alta, cambio e importación). Devuelve los errores en español, sin lanzar. */
export function parseRow(raw: unknown, label: string): { row?: RowInput; errors: string[] } {
  if (!isObj(raw)) return { errors: [`${label}: formato inválido`] };
  const errors: string[] = [];
  // El área es obligatoria en la etapa «area»; en «tipoGasto» puede faltar y significa «cualquier área» («*»).
  const stageOk = (EXPENSE_STAGES as readonly unknown[]).includes(raw.stage);
  const areaText = text(raw.area, `${label}, área`, 80, errors, stageOk && raw.stage === 'area');
  const area = areaText ?? (stageOk && raw.stage === 'tipoGasto' ? ANY_AREA : null);
  const expenseType = text(raw.expenseType, `${label}, tipo de gasto`, 120, errors, false);
  const concept = text(raw.concept, `${label}, concepto`, 120, errors, false);
  const signerId = text(raw.signerId, `${label}, signerId`, 200, errors, true);
  const name = text(raw.name, `${label}, nombre`, 200, errors, false);
  const email = text(raw.email, `${label}, correo`, 254, errors, false);
  if (email && !EMAIL_RE.test(email)) errors.push(`${label}, correo: no parece un correo válido`);
  if (!stageOk) errors.push(`${label}, etapa: debe ser area o tipoGasto`);
  const minAmount = amount(raw.minAmount, `${label}, monto mínimo`, errors);
  const maxAmount = amount(raw.maxAmount, `${label}, monto máximo`, errors);
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) errors.push(`${label}: el monto mínimo no puede ser mayor al máximo`);
  if (raw.active !== undefined && typeof raw.active !== 'boolean') errors.push(`${label}, activo: debe ser verdadero o falso`);
  if (errors.length) return { errors };
  return {
    errors,
    row: {
      area: area!,
      expenseType,
      concept,
      stage: raw.stage as ExpenseStage,
      minAmount,
      maxAmount,
      signerId: signerId!,
      name,
      email,
      active: raw.active === undefined ? true : (raw.active as boolean),
    },
  };
}

export function assertRow(raw: unknown, label = 'Fila'): RowInput {
  const { row, errors } = parseRow(raw, label);
  if (!row) throw new BadRequestException({ message: 'La fila no es válida', errors });
  return row;
}
