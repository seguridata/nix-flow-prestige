/**
 * Canonical domain types for the Prestige frontend.
 * Mirrors backend/contracts/openapi.yaml — keep both in sync when either changes.
 */

export type CaseStatus = "ABIERTO" | "EN_PROCESO" | "CERRADO";

export interface CaseRecord {
  id: string;
  tenantId: string;
  title: string;
  status: CaseStatus;
  createdAt: string;
}

export interface DocumentRecord {
  id: string;
  caseId: string;
  filename: string;
  version: number;
  hash: string;
  locked: boolean;
}

export type SignatureMethod = "DIGITAL" | "AUTOGRAFA" | "BIOMETRICA";
export type SigningOrder = "SECUENCIAL" | "PARALELO";
export type SignerStatus = "PENDIENTE" | "FIRMADO" | "RECHAZADO";
export type SignatureRequestStatus =
  | "PENDIENTE"
  | "EN_FIRMA"
  | "COMPLETADA"
  | "RECHAZADA"
  | "EXPIRADA";

/** Miembro del directorio del tenant, para autocompletar firmantes. */
export interface Colleague {
  userId: string;
  name: string | null;
  email: string | null;
}

export interface Signer {
  signerId: string;
  name?: string;
  email?: string;
  role?: "FIRMANTE" | "REVISOR";
  status: SignerStatus;
  signedAt: string | null;
  usedMethod?: SignatureMethod;
  delegatedTo?: string | null;
  delegatedToName?: string | null;
}

export interface SignatureRequest {
  id: string;
  documentId: string;
  /** Métodos autorizados por el remitente; el firmante elige uno al firmar. */
  methods: SignatureMethod[];
  order: SigningOrder;
  status: SignatureRequestStatus;
  requestedBy?: string;
  requestedByName?: string;
  createdAt: string;
  signers: Signer[];
}

export type WorkflowInstanceStatus = "ACTIVO" | "COMPLETADO" | "CANCELADO";

export interface WorkflowInstance {
  id: string;
  processDefinitionKey: string;
  caseId: string;
  status: WorkflowInstanceStatus;
}

export interface HumanTask {
  id: string;
  name: string;
  processInstanceId: string;
  candidateGroups: string[];
  dueDate: string | null;
}

/* ---------------------------------------------------------------------- */
/* Feature: interactive signature-field placement                        */
/* ---------------------------------------------------------------------- */

export type SignatureFieldType = "SIGNATURE" | "INITIALS" | "DATE" | "TEXT";

export interface SignatureField {
  id: string;
  documentId: string;
  signerId: string;
  type: SignatureFieldType;
  page: number;
  /** Normalized 0..1 coordinates so the field survives PDF re-renders/zoom. */
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required: boolean;
  createdAt?: string;
}

/* ---------------------------------------------------------------------- */
/* Feature: realtime presence & notifications                            */
/* ---------------------------------------------------------------------- */

export type RealtimeEventType =
  | "PRESENCE_JOIN"
  | "PRESENCE_LEAVE"
  | "DOCUMENT_VIEWED"
  | "SIGNATURE_APPLIED"
  | "REQUEST_COMPLETED";

export interface RealtimeEvent {
  type: RealtimeEventType;
  documentId: string;
  actorId: string;
  actorName?: string;
  at: string;
}

export interface PresenceState {
  actorId: string;
  actorName: string;
  since: string;
}

/* ---------------------------------------------------------------------- */
/* Feature: evidence manifest & cryptographic verification                */
/* ---------------------------------------------------------------------- */

export interface ChainOfCustodyEvent {
  action: string;
  actorId: string;
  at: string;
  hashAfter: string;
}

export interface ConsentRecord {
  id: string;
  signerId: string;
  acceptedAt: string;
  ipHash: string;
  textVersion: string;
}

export interface EvidenceSignature {
  signerId: string;
  email?: string;
  algorithm: string;
  signatureHash: string;
  signedAt: string;
}

/**
 * Forma exacta devuelta por el backend (mapea 1:1 el modelo Prisma
 * `EvidenceManifest`, ver backend/bff/src/evidence/evidence.service.ts).
 */
export interface EvidenceManifest {
  id: string;
  signatureRequestId: string;
  manifestId: string;
  documentId: string;
  documentVersion: number;
  tenantId: string;
  originalHash: string;
  presentedHash: string;
  signedHash: string;
  packageHash: string;
  signingOrder: SigningOrder;
  chainOfCustody: ChainOfCustodyEvent[];
  consentRecords: ConsentRecord[];
  signatures: EvidenceSignature[];
  timestampProvider: string;
  timestampIssuedAt: string;
  timestampTokenHash: string;
  validationConclusion: "VALID" | "INVALID" | "UNKNOWN" | string;
  validationReasons: string[];
  createdAt: string;
}

export interface EvidenceVerificationResult {
  valid: boolean;
  mismatches: string[];
}
