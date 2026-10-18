import { ApiError, apiClient } from "./api-client";
import type { VerificationResult } from "@/libs/evidence-checks";
import type { EvidenceManifest } from "@/libs/types";

/** El BFF responde 404 si la solicitud no tiene evidencia (o no es del tenant): se trata como `null`. */
export async function fetchEvidenceForRequest(signatureRequestId: string) {
  try {
    return await apiClient.get<EvidenceManifest | null>(
      `/evidence/by-request/${encodeURIComponent(signatureRequestId)}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export function fetchEvidenceManifest(manifestId: string) {
  return apiClient.get<EvidenceManifest>(`/evidence/${encodeURIComponent(manifestId)}`);
}

export function verifyEvidenceManifest(manifestId: string) {
  return apiClient.get<VerificationResult>(
    `/evidence/${encodeURIComponent(manifestId)}/verify`,
  );
}

/** Expediente probatorio en ZIP (PDF firmado, manifiesto, sello de tiempo y verificador sin conexión). */
export const evidenceDossierUrl = (manifestId: string) => `/api/bff/evidence/${encodeURIComponent(manifestId)}/dossier`;
