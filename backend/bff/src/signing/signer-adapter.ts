import type { SignatureMethod } from '@prisma/client';

export interface SignCommand {
  method: SignatureMethod;
  signerId: string;
  documentHash: string;
  /** Trazo autógrafo capturado (PNG). Bytes, nunca base64 en tránsito ni en BD. */
  signatureImage?: Buffer;
  biometricSessionId?: string;
}

export interface SignResult {
  algorithm: string;
  signatureHash: string;
  provider: string;
  pending?: boolean;
  detail?: string;
}

export interface SignerAdapter {
  method: SignatureMethod;
  capabilities(): { configured: boolean; reason?: string };
  sign(command: SignCommand): Promise<SignResult>;
}
