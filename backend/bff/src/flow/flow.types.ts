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

export type Who =
  | { type: 'initiator' }
  | { type: 'fixed'; signerId: string; name?: string; email?: string }
  | { type: 'ask'; prompt: string }
  /** Se resuelve con la matriz de responsables de gasto del tenant; `prompt` es la pregunta de respaldo si no hay coincidencia. */
  | { type: 'matrix'; stage: MatrixStage; prompt: string };

export const MATRIX_STAGES = ['area', 'tipoGasto'] as const;
export type MatrixStage = (typeof MATRIX_STAGES)[number];

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
}

export type FlowValues = Record<string, string | number | null | undefined>;

export interface ResolvedStep {
  step: FlowStep;
  active: boolean;
}

export const MAX_STEPS = 20;
