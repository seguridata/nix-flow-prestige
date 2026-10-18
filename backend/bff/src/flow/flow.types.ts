/**
 * Flujo de un formato o de un proceso publicable: el subconjunto de BPMN que Prestige sabe EJECUTAR.
 * Se guarda como JSON (`ProcessDefinition.flow`, `DocumentTemplate.flow`) y de él se genera el BPMN.
 */
export type VarType = 'text' | 'date' | 'number' | 'select';

export interface FlowVariable {
  key: string;
  label: string;
  type: VarType;
  required: boolean;
  options?: string[];
}

export type Op = '>' | '>=' | '<' | '<=' | '==' | '!=';

export interface Condition {
  variable: string;
  op: Op;
  value: string | number;
}

/** Operadores de una consulta (ADR-008 §4): «valor de la solicitud» OPERADOR «valor de la fila». */
export const LOOKUP_OPS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn', 'isEmpty', 'isNotEmpty',
] as const;
export type LookupOp = (typeof LOOKUP_OPS)[number];

export interface LookupCondition {
  /** Clave de columna de la tabla. */
  column: string;
  op: LookupOp;
  /** De dónde sale el valor de la solicitud. No aplica a `isEmpty` / `isNotEmpty`. */
  source?: { var: string } | { value: string | number };
  /** Por defecto `true`: una celda vacía en la fila cumple la condición («cualquiera»). */
  emptyMatchesAny?: boolean;
}

export interface LookupQuery {
  /** `key` de la tabla de consulta del tenant. */
  table: string;
  match: LookupCondition[];
}

/** De qué columnas de la fila sale la persona. */
export interface LookupPerson {
  signerId: string;
  name?: string;
  email?: string;
}

export type Who =
  | { type: 'initiator' }
  | { type: 'fixed'; signerId: string; name?: string; email?: string }
  | { type: 'ask'; prompt: string }
  /** Se resuelve consultando una tabla del tenant; `prompt` es la pregunta de respaldo si no hay coincidencia. */
  | { type: 'lookup'; query: LookupQuery; person: LookupPerson; prompt: string };

/** Variable calculada desde una tabla antes de decidir qué pasos aplican; sirve en `when`. */
export interface DerivedVariable {
  key: string;
  label: string;
  type: VarType;
  query: LookupQuery;
  /** Columna de la fila cuyo valor se toma. */
  column: string;
  /** Sin coincidencia: `'empty'` (defecto) deja la variable vacía; `'fail'` impide crear la solicitud. */
  onMiss?: 'empty' | 'fail';
}

export interface FlowStep {
  id: string;
  label: string;
  who: Who;
  role: 'FIRMANTE' | 'REVISOR';
  /** Condiciones unidas con AND; vacío o ausente = el paso siempre aplica. */
  when?: Condition[];
}

export interface Flow {
  variables: FlowVariable[];
  steps: FlowStep[];
  order: 'SECUENCIAL' | 'PARALELO';
  slaHours: number;
  derived?: DerivedVariable[];
}

export type FlowValues = Record<string, string | number | null | undefined>;

export interface ResolvedStep {
  step: FlowStep;
  active: boolean;
}

export const MAX_STEPS = 20;
