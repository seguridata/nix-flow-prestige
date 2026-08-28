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
}
