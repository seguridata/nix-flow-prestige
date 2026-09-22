import type { SignatureMethod } from '@prisma/client';

export interface SignatureFieldRect {
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export interface SignedCertificate {
  serialNumber: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
}

export interface SignCommand {
  method: SignatureMethod;
  signerId: string;
  signerName?: string;
  documentId: string;
  /** SHA-256 (hex) del PDF actual en claro. */
  documentHash: string;
  /** Bytes del PDF actual. Los adaptadores que incrustan firma devuelven `signedPdf`. */
  pdfBytes: Buffer;
  /** Trazo autógrafo (PNG). Bytes, nunca base64. */
  signatureImage?: Buffer;
  /** Recuadro donde pintar la apariencia visible de la firma. */
  field?: SignatureFieldRect;
  biometricSessionId?: string;
}

export interface SignResult {
  algorithm: string;
  provider: string;
  /** Hash que identifica la firma en la evidencia (SHA-256 del PDF firmado o de la operación). */
  signatureHash: string;
  /** PDF con la firma incrustada (DIGITAL: PAdES; AUTÓGRAFA: trazo sellado). */
  signedPdf?: Buffer;
  /** Certificado del firmante (DIGITAL). Es público; se guarda en la evidencia. */
  certificate?: SignedCertificate;
  /** Firma iniciada pero no concluida (2FA / biometría / firma asíncrona). */
  pending?: boolean;
  /** Referencia opaca de la operación pendiente para reconciliar más tarde. */
  pendingRef?: string;
  detail?: string;
}

/** Resultado de reconciliar una firma que quedó `pending`. */
export interface ReconcileResult {
  status: 'completed' | 'failed' | 'pending';
  signedPdf?: Buffer;
  signatureHash?: string;
  certificate?: SignedCertificate;
  reason?: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  /** Nº de firmas criptográficas encontradas en el PDF. */
  signatures: number;
}

/**
 * Contrato común de los tres métodos de firma (M09). `sign` es obligatorio;
 * `verify` lo implementan los que incrustan una firma criptográfica
 * verificable (DIGITAL). Añadir un método nuevo no debe tocar el workflow
 * ni el portal.
 */
export interface SignerAdapter {
  readonly method: SignatureMethod;
  capabilities(): { configured: boolean; reason?: string };
  sign(command: SignCommand): Promise<SignResult>;
  verify?(pdfBytes: Buffer): Promise<VerifyResult>;
  /** Consulta el estado de una firma `pending` (lo implementan los métodos asíncronos). */
  reconcile?(pendingRef: string, command: SignCommand): Promise<ReconcileResult>;
}
