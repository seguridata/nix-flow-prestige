import { apiClient, newIdempotencyKey } from "./api-client";
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { buildSignPayload } from "./payloads";
import type { SignatureRequest, SignatureMethod, SigningOrder } from "@/libs/types";

export interface CreateSignatureRequestBody {
  documentId: string;
  methods: SignatureMethod[];
  order: SigningOrder;
  slaHours?: number;
  // requestedBy / tenant salen del token en el BFF.
  signers: { signerId: string; name?: string; email?: string; role?: "FIRMANTE" | "REVISOR" }[];
  requirePasskey?: boolean;
  kycPolicy?: "NONE" | "ONCE" | "EVERY_SIGN";
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
    method: SignatureMethod;
    consentAccepted?: boolean;
    biometricSessionId?: string;
    passkeyAssertionId?: string;
  },
  autograph?: Blob,
) {
  body = buildSignPayload(body) as typeof body;
  const path = `/signature-requests/${requestId}/actions/sign`;
  const opts = { idempotencyKey: newIdempotencyKey() };
  if (autograph) {
    const form = new FormData();
    form.append("file", autograph, "trazo.png");
    form.append("method", body.method);
    if (body.consentAccepted !== undefined) form.append("consentAccepted", String(body.consentAccepted));
    if (body.biometricSessionId) form.append("biometricSessionId", body.biometricSessionId);
    if (body.passkeyAssertionId) form.append("passkeyAssertionId", body.passkeyAssertionId);
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
  body: { toSignerId: string; toName?: string },
) {
  return apiClient.post<SignatureRequest>(
    `/signature-requests/${requestId}/actions/delegate`,
    body,
    { idempotencyKey: newIdempotencyKey() },
  );
}

/**
 * Ceremonia passkey del firmante INTERNO (sesión autenticada, vía proxy /api/bff).
 * Rutas reales del backend (backend/bff/src/webauthn/passkey-authenticate.controller.ts):
 *   POST /webauthn/authenticate/begin   body { signatureRequestId } -> { assertionId, options }
 *   POST /webauthn/authenticate/finish  body { assertionId, response } -> { ok }
 * El firmante sale del token. El assertionId verificado se manda como `passkeyAssertionId` en sign.
 */
export function beginInternalPasskey(signatureRequestId: string) {
  return apiClient.post<{ assertionId: string; options: PublicKeyCredentialRequestOptionsJSON }>(
    "/webauthn/authenticate/begin",
    { signatureRequestId },
  );
}

export function finishInternalPasskey(assertionId: string, response: unknown) {
  return apiClient.post<{ ok: true }>("/webauthn/authenticate/finish", {
    assertionId,
    response,
  });
}

/** Ejecuta begin -> WebAuthn del navegador -> finish; devuelve el assertionId verificado. */
export async function verifyInternalPasskey(signatureRequestId: string): Promise<string> {
  const { assertionId, options } = await beginInternalPasskey(signatureRequestId);
  const response = await startAuthentication({ optionsJSON: options });
  await finishInternalPasskey(assertionId, response);
  return assertionId;
}
