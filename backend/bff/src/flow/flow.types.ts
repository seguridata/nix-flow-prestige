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
  | { type: 'ask'; prompt: string };

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
