import { ApiError, apiClient } from "./api-client";
import type { EvidenceManifest, EvidenceVerificationResult } from "@/libs/types";

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
  return apiClient.get<EvidenceVerificationResult>(
    `/evidence/${encodeURIComponent(manifestId)}/verify`,
  );
}
