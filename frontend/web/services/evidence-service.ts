import { apiClient } from "./api-client";
import type { EvidenceManifest, EvidenceVerificationResult } from "@/libs/types";

export function fetchEvidenceForRequest(signatureRequestId: string) {
  return apiClient.get<EvidenceManifest | null>(
    `/evidence/by-request/${encodeURIComponent(signatureRequestId)}`,
  );
}

export function fetchEvidenceManifest(manifestId: string) {
  return apiClient.get<EvidenceManifest>(`/evidence/${encodeURIComponent(manifestId)}`);
}

export function verifyEvidenceManifest(manifestId: string) {
  return apiClient.get<EvidenceVerificationResult>(
    `/evidence/${encodeURIComponent(manifestId)}/verify`,
  );
}
