export const PRESTIGE_TASK_QUEUE = 'prestige';
export const CONTRATO_DOS_PARTES = 'contratoDosPartes';

export interface ContratoWorkflowInput {
  signatureRequestId: string;
  documentId: string;
  caseId?: string;
  order: 'SECUENCIAL' | 'PARALELO';
  slaHours: number;
  signers: { signerId: string; name?: string }[];
}

export interface ContratoWorkflowState {
  signatureRequestId: string;
  phase: 'FIRMA' | 'EVIDENCIA' | 'CERRADO' | 'CANCELADO' | 'EXPIRADO';
  signed: string[];
  rejectedBy?: string;
  currentSignerId?: string;
  /** M07 — recordatorios/escalamientos emitidos por los timers de Temporal. */
  nudges: number;
}

export type NudgeKind = 'REMINDER' | 'ESCALATION';

export interface NudgeCommand {
  signatureRequestId: string;
  kind: NudgeKind;
  /** Fracción del SLA en la que se dispara (0.5, 0.75, 0.9…). */
  ratio: number;
  /** En orden secuencial, el firmante concreto al que apunta el recordatorio. */
  signerId?: string;
}

/**
 * Fracciones del SLA en las que el workflow envía un aviso. `< 0.9` es
 * recordatorio (nudge); `>= 0.9` escala al emisor y observadores.
 */
export const NUDGE_MARKS = [0.5, 0.75, 0.9] as const;

export function nudgeKindFor(mark: number): NudgeKind {
  return mark >= 0.9 ? 'ESCALATION' : 'REMINDER';
}
