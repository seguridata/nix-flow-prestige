import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCommentPayload,
  buildConsentPayload,
  buildDelegatePayload,
  buildOnboardingActionPayload,
  buildOnboardingCreatePayload,
  buildSignPayload,
} from "@/services/payloads";

/**
 * Listas permitidas copiadas de los DTO del BFF (ValidationPipe con
 * whitelist + forbidNonWhitelisted: un campo extra => 400).
 */
// backend/bff/src/collaboration/collaboration.controller.ts (AddCommentDto)
const COMMENT_KEYS = ["body"];
// backend/bff/src/signature-requests/dto.ts (DelegateDto)
const DELEGATE_KEYS = ["toSignerId", "toName"];
// backend/bff/src/onboarding/dto.ts (CreateOnboardingDto)
const ONBOARDING_CREATE_KEYS = ["kind", "fullName", "email", "curp", "rfc", "biometricConsent"];
// backend/bff/src/onboarding/dto.ts (OnboardingActionDto) — verify-ine y reject
const ONBOARDING_ACTION_KEYS = ["notes", "approve"];
// backend/bff/src/signature-requests/dto.ts (SignActionDto)
const SIGN_KEYS = ["method", "biometricSessionId", "passkeyAssertionId", "consentAccepted"];
// backend/bff/src/signature-requests/dto.ts (ConsentAcceptDto: vacío)
const CONSENT_KEYS: string[] = [];

function onlyAllowed(obj: object, allowed: string[]) {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

describe("contratos de payload hacia el BFF", () => {
  it("comentarios: solo body", () => {
    expect(onlyAllowed(buildCommentPayload("hola"), COMMENT_KEYS)).toEqual([]);
  });

  it("delegar: sin fromSignerId", () => {
    const p = buildDelegatePayload(" ana ", " Ana ");
    expect(onlyAllowed(p, DELEGATE_KEYS)).toEqual([]);
    expect(p).toEqual({ toSignerId: "ana", toName: "Ana" });
    expect(buildDelegatePayload("ana", "  ")).toEqual({ toSignerId: "ana" });
  });

  it("onboarding create: sin requestedBy/requestedByName", () => {
    const p = buildOnboardingCreatePayload({
      kind: "EMPLEADO",
      fullName: "Juan Pérez",
      email: "j@x.mx",
      curp: "",
      rfc: "ABC",
    });
    expect(onlyAllowed(p, ONBOARDING_CREATE_KEYS)).toEqual([]);
    expect(p.biometricConsent).toBe(true);
  });

  it("onboarding verify-ine / reject: sin actorId/actorName", () => {
    expect(onlyAllowed(buildOnboardingActionPayload(), ONBOARDING_ACTION_KEYS)).toEqual([]);
    const reject = buildOnboardingActionPayload({ notes: "Rechazado por RH" });
    expect(onlyAllowed(reject, ONBOARDING_ACTION_KEYS)).toEqual([]);
    expect(reject).toEqual({ notes: "Rechazado por RH" });
  });

  it("sign: solo claves del SignActionDto y descarta extras", () => {
    const dirty = {
      method: "PASSKEY",
      consentAccepted: true,
      passkeyAssertionId: "a1",
      signerId: "evil",
    } as Parameters<typeof buildSignPayload>[0];
    const p = buildSignPayload(dirty);
    expect(onlyAllowed(p, SIGN_KEYS)).toEqual([]);
    expect(p).toEqual({ method: "PASSKEY", consentAccepted: true, passkeyAssertionId: "a1" });
  });

  it("consent: cuerpo vacío", () => {
    expect(onlyAllowed(buildConsentPayload(), CONSENT_KEYS)).toEqual([]);
  });
});

describe("servicios usan los constructores", () => {
  afterEach(() => vi.restoreAllMocks());

  it("acceptPublicConsent manda cuerpo vacío", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { acceptPublicConsent } = await import("@/services/public-sign-service");
    await acceptPublicConsent("tok");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({});
    vi.unstubAllGlobals();
  });

  it("signPublicLink filtra claves extra", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { signPublicLink } = await import("@/services/public-sign-service");
    await signPublicLink("tok", {
      method: "ACCEPT",
      consentAccepted: true,
      extra: 1,
    } as unknown as Parameters<typeof signPublicLink>[1]);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(Object.keys(JSON.parse(init.body as string)).filter((k) => !SIGN_KEYS.includes(k))).toEqual([]);
    vi.unstubAllGlobals();
  });
});
