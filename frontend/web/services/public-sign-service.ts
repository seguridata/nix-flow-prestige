import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { buildConsentPayload, buildPublicRejectPayload, buildSignPayload } from "@/services/payloads";

const BASE = "/api/public-sign";

export interface PublicLinkContext {
  purpose: string;
  signerId: string;
  signatureRequestId: string | null;
  expiresAt: string;
  documentId: string | null;
  documentTitle: string | null;
  methods: string[];
  order: string | null;
  status: string | null;
  myStatus: string | null;
  signerName: string | null;
  requestedByName: string | null;
  requirePasskey: boolean;
}

/** Error HTTP del portal público; conserva el status para mensajes específicos. */
export class PublicLinkError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PublicLinkError";
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new PublicLinkError((json as { message?: string }).message ?? `Error ${res.status}`, res.status);
  }
  return json as T;
}

export function resolvePublicLink(token: string) {
  return fetch(`${BASE}/${encodeURIComponent(token)}`, { cache: "no-store" }).then(
    parse<PublicLinkContext>,
  );
}

/** El BFF toma IP y user-agent de la conexión; el cuerpo va vacío (ConsentAcceptDto). */
export function acceptPublicConsent(token: string) {
  return fetch(`${BASE}/${encodeURIComponent(token)}/consent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildConsentPayload()),
  }).then(parse);
}

export function signPublicLink(
  token: string,
  body: {
    method: string;
    consentAccepted?: boolean;
    biometricSessionId?: string;
    passkeyAssertionId?: string;
  },
  autograph?: Blob,
) {
  const url = `${BASE}/${encodeURIComponent(token)}/sign`;
  body = buildSignPayload(body);
  if (autograph) {
    const form = new FormData();
    form.append("file", autograph, "trazo.png");
    form.append("method", body.method);
    if (body.consentAccepted !== undefined) form.append("consentAccepted", String(body.consentAccepted));
    if (body.biometricSessionId) form.append("biometricSessionId", body.biometricSessionId);
    if (body.passkeyAssertionId) form.append("passkeyAssertionId", body.passkeyAssertionId);
    return fetch(url, { method: "POST", body: form }).then(parse);
  }
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(parse);
}

export function beginPasskey(token: string) {
  return fetch(`${BASE}/${encodeURIComponent(token)}/passkey/begin`, { method: "POST" }).then(
    parse<{ assertionId: string; options: PublicKeyCredentialRequestOptionsJSON }>,
  );
}

export function finishPasskey(token: string, assertionId: string, response: unknown) {
  return fetch(`${BASE}/${encodeURIComponent(token)}/passkey/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assertionId, response }),
  }).then(parse<{ ok: true }>);
}

/** Rechaza la solicitud desde el portal; el firmante lo deriva el BFF del enlace. */
export function rejectPublicLink(token: string, reason?: string) {
  return fetch(`${BASE}/${encodeURIComponent(token)}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildPublicRejectPayload(reason)),
  }).then(parse<{ status: string }>);
}
