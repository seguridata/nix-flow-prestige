/**
 * Constructores puros de los cuerpos que el frontend manda al BFF.
 *
 * El BFF usa ValidationPipe global con whitelist + forbidNonWhitelisted: cualquier
 * campo extra devuelve 400. El actor (autor, firmante, solicitante) SIEMPRE sale
 * del token en el servidor, nunca del cliente. Los tests de contrato
 * (`__tests__/contracts/payloads.test.ts`) verifican estas formas contra los DTO.
 */

/** DTO: backend/bff/src/collaboration/collaboration.controller.ts (AddCommentDto). */
export function buildCommentPayload(body: string) {
  return { body };
}

/** DTO: backend/bff/src/signature-requests/dto.ts (DelegateDto). */
export function buildDelegatePayload(toSignerId: string, toName?: string) {
  const name = toName?.trim();
  return { toSignerId: toSignerId.trim(), ...(name ? { toName: name } : {}) };
}

/** DTO: backend/bff/src/onboarding/dto.ts (CreateOnboardingDto). */
export function buildOnboardingCreatePayload(form: {
  fullName: string;
  email: string;
  curp?: string;
  rfc?: string;
  kind?: "EMPLEADO" | "PROVEEDOR" | "CLIENTE";
}) {
  const out: {
    fullName: string;
    email: string;
    curp?: string;
    rfc?: string;
    kind?: "EMPLEADO" | "PROVEEDOR" | "CLIENTE";
    biometricConsent: true;
  } = { fullName: form.fullName, email: form.email, biometricConsent: true };
  if (form.curp) out.curp = form.curp;
  if (form.rfc) out.rfc = form.rfc;
  if (form.kind) out.kind = form.kind;
  return out;
}

/** DTO: backend/bff/src/onboarding/dto.ts (OnboardingActionDto: notes, approve). */
export function buildOnboardingActionPayload(opts: { notes?: string; approve?: boolean } = {}) {
  return {
    ...(opts.notes ? { notes: opts.notes } : {}),
    ...(opts.approve !== undefined ? { approve: opts.approve } : {}),
  };
}

/** DTO: backend/bff/src/signature-requests/dto.ts (SignActionDto / PasskeyFinishDto). */
export function buildSignPayload(body: {
  method: string;
  consentAccepted?: boolean;
  biometricSessionId?: string;
  passkeyAssertionId?: string;
}) {
  const out: {
    method: string;
    consentAccepted?: boolean;
    biometricSessionId?: string;
    passkeyAssertionId?: string;
  } = { method: body.method };
  if (body.consentAccepted !== undefined) out.consentAccepted = body.consentAccepted;
  if (body.biometricSessionId) out.biometricSessionId = body.biometricSessionId;
  if (body.passkeyAssertionId) out.passkeyAssertionId = body.passkeyAssertionId;
  return out;
}

/**
 * DTO: ConsentAcceptDto (vacío). La IP y el user-agent los toma el servidor de
 * la conexión; mandarlos desde el cliente provoca 400.
 */
export function buildConsentPayload() {
  return {};
}

/**
 * DTO: backend/bff/src/signature-requests/dto.ts (PublicRejectDto: reason, máx 500).
 * El firmante sale del enlace; nunca se manda signerId.
 */
export function buildPublicRejectPayload(reason?: string) {
  const r = reason?.trim().slice(0, 500);
  return r ? { reason: r } : {};
}
