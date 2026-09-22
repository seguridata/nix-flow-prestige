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
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error((json as { message?: string }).message ?? `Error ${res.status}`);
  return json as T;
}

export function resolvePublicLink(token: string) {
  return fetch(`${BASE}/${encodeURIComponent(token)}`, { cache: "no-store" }).then(
    parse<PublicLinkContext>,
  );
}

export function acceptPublicConsent(token: string, userAgent?: string) {
  return fetch(`${BASE}/${encodeURIComponent(token)}/consent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userAgent: userAgent ?? navigator.userAgent }),
  }).then(parse);
}

export function signPublicLink(
  token: string,
  body: { method: string; consentAccepted?: boolean; biometricSessionId?: string },
  autograph?: Blob,
) {
  const url = `${BASE}/${encodeURIComponent(token)}/sign`;
  if (autograph) {
    const form = new FormData();
    form.append("file", autograph, "trazo.png");
    form.append("method", body.method);
    if (body.consentAccepted !== undefined) form.append("consentAccepted", String(body.consentAccepted));
    if (body.biometricSessionId) form.append("biometricSessionId", body.biometricSessionId);
    return fetch(url, { method: "POST", body: form }).then(parse);
  }
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(parse);
}
