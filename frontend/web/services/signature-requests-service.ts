import { apiClient, newIdempotencyKey } from "./api-client";
import type { SignatureRequest, SignatureMethod, SigningOrder } from "@/libs/types";

export interface CreateSignatureRequestBody {
  documentId: string;
  methods: SignatureMethod[];
  order: SigningOrder;
  requestedBy: string;
  requestedByName: string;
  signers: { signerId: string; name?: string; email?: string; role?: "FIRMANTE" | "REVISOR" }[];
}

export function createSignatureRequest(body: CreateSignatureRequestBody) {
  return apiClient.post<SignatureRequest>("/signature-requests", body);
}

export function fetchSignatureRequestsForDocument(documentId: string) {
  return apiClient.get<SignatureRequest[]>(
    `/signature-requests?documentId=${encodeURIComponent(documentId)}`,
  );
}

export function signRequest(
  requestId: string,
  body: {
    signerId: string;
    method: SignatureMethod;
    consentAccepted?: boolean;
    biometricSessionId?: string;
  },
  autograph?: Blob,
) {
  const path = `/signature-requests/${requestId}/actions/sign`;
  const opts = { idempotencyKey: newIdempotencyKey() };
  if (autograph) {
    const form = new FormData();
    form.append("file", autograph, "trazo.png");
    form.append("signerId", body.signerId);
    form.append("method", body.method);
    if (body.consentAccepted !== undefined) form.append("consentAccepted", String(body.consentAccepted));
    if (body.biometricSessionId) form.append("biometricSessionId", body.biometricSessionId);
    return apiClient.post<SignatureRequest>(path, form, opts);
  }
  return apiClient.post<SignatureRequest>(path, body, opts);
}

export function fetchConsentText() {
  return apiClient.get<{ version: string; text: string }>("/signature-requests/consent");
}

export function fetchSigningCapabilities() {
  return apiClient.get<{ method: SignatureMethod; configured: boolean; reason?: string }[]>(
    "/signature-requests/capabilities",
  );
}

export function cancelRequest(requestId: string, actorId?: string) {
  return apiClient.post<SignatureRequest>(
    `/signature-requests/${requestId}/actions/cancel`,
    { actorId },
    { idempotencyKey: newIdempotencyKey() },
  );
}

export function delegateRequest(
  requestId: string,
  body: { fromSignerId: string; toSignerId: string; toName?: string },
) {
  return apiClient.post<SignatureRequest>(
    `/signature-requests/${requestId}/actions/delegate`,
    body,
    { idempotencyKey: newIdempotencyKey() },
  );
}
