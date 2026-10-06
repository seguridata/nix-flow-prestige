import { describe, expect, it } from "vitest";

import {
  biometricOutcome,
  enableBlockers,
  enabledReviewMode,
  groupOnboarding,
  joinEs,
  nextAction,
  onboardingAuditLine,
  onboardingSteps,
  predictReviewMode,
  type OnboardingCaseView,
} from "@/libs/onboarding-flow";

const base: OnboardingCaseView = {
  id: "o1",
  kind: "EMPLEADO",
  status: "BORRADOR",
  fullName: "Marcos Pérez",
  email: "marcos@ejemplo.mx",
  ineVerified: false,
  hasIneFront: false,
  hasIneBack: false,
  hasSelfie: false,
  livenessOk: false,
  faceMatchOk: false,
  biometricConsentAt: "2026-10-05T16:24:00Z",
  createdAt: "2026-10-05T16:00:00Z",
};
const row = (over: Partial<OnboardingCaseView> = {}): OnboardingCaseView => ({ ...base, ...over });
const ready = row({ status: "EN_REVISION", hasIneFront: true, hasIneBack: true, hasSelfie: true });

describe("onboardingSteps", () => {
  it("marca el primer paso pendiente como el actual", () => {
    const steps = onboardingSteps(row({ hasIneFront: true, hasIneBack: true }));
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "todo", "todo"]);
  });

  it("dice qué falta de la INE", () => {
    expect(onboardingSteps(row({ hasIneFront: true }))[1]?.detail).toBe("Falta el reverso.");
    expect(onboardingSteps(row())[1]?.detail).toBe("Falta cargar frente y reverso.");
  });

  it("sin consentimiento el actual es el primero", () => {
    expect(onboardingSteps(row({ biometricConsentAt: null }))[0]?.state).toBe("current");
  });

  it("un alta habilitada tiene todo hecho", () => {
    const steps = onboardingSteps({ ...ready, status: "HABILITADO" });
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });

  it("un alta habilitada sin registro de un paso no lo muestra 'en curso'", () => {
    const steps = onboardingSteps({ ...ready, status: "HABILITADO", biometricConsentAt: null });
    expect(steps[0]).toMatchObject({ state: "todo", detail: "Sin registro en el sistema." });
    expect(steps.some((s) => s.state === "current")).toBe(false);
  });

  it("un alta rechazada deja lo pendiente detenido, no 'en curso'", () => {
    const steps = onboardingSteps(row({ status: "RECHAZADO", hasIneFront: true, hasIneBack: true }));
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "stopped", "stopped", "stopped"]);
  });
});

describe("predictReviewMode (refleja enable-policy del servidor)", () => {
  it("motor que confirmó: engine", () => {
    expect(predictReviewMode({ livenessOk: true, faceMatchOk: true, biometricEngine: "face-api" })).toBe("engine");
  });
  it("sin motor: manual", () => {
    expect(predictReviewMode({ livenessOk: false, faceMatchOk: false, biometricEngine: null })).toBe("manual");
    expect(predictReviewMode({ livenessOk: false, faceMatchOk: false, biometricEngine: "noop" })).toBe("manual");
  });
  it("motor que corrió y no pasó: requiere anulación", () => {
    expect(predictReviewMode({ livenessOk: true, faceMatchOk: false, biometricEngine: "face-api" })).toBe("needs-override");
  });
});

describe("biometricOutcome", () => {
  it("sin selfie, pendiente", () => {
    expect(biometricOutcome(row()).kind).toBe("pending");
  });
  it("sin motor no hay veredicto automático", () => {
    const o = biometricOutcome({ ...ready, biometricEngine: "noop" });
    expect(o).toMatchObject({ kind: "no-engine", title: "Sin motor biométrico configurado" });
  });
  it("motor que pasó incluye la coincidencia", () => {
    const o = biometricOutcome({ ...ready, biometricEngine: "face-api", livenessOk: true, faceMatchOk: true, faceMatchScore: 0.93 });
    expect(o.kind).toBe("engine-pass");
    expect(o.detail).toContain("93 %");
  });
  it("motor que no pasó dice qué falló", () => {
    const o = biometricOutcome({ ...ready, biometricEngine: "face-api", livenessOk: true, faceMatchOk: false });
    expect(o).toMatchObject({ kind: "engine-fail" });
    expect(o.detail).toBe("El rostro no coincidió con la INE.");
  });
});

describe("nextAction y groupOnboarding", () => {
  it("falta captura: no es acción de RH todavía", () => {
    expect(nextAction(row({ hasIneFront: true, hasIneBack: true }))).toEqual({
      needsRh: false,
      sentence: "Falta capturar la prueba de vida",
    });
  });
  it("con todo capturado, la decisión es de RH", () => {
    expect(nextAction(ready)).toEqual({ needsRh: true, sentence: "Tu decisión: verificar la INE y habilitar" });
    expect(nextAction({ ...ready, ineVerified: true }).sentence).toBe("Tu decisión: habilitar o rechazar");
  });
  it("cerradas dicen su resultado", () => {
    expect(nextAction({ ...ready, status: "HABILITADO", enabledSignerId: "marcos" }).sentence).toBe("Ya puede firmar como marcos");
    expect(nextAction({ ...ready, status: "RECHAZADO" }).sentence).toBe("Alta rechazada");
  });
  it("agrupa por lo que debe hacer RH y ordena por fecha", () => {
    const g = groupOnboarding([
      row({ id: "a", createdAt: "2026-10-01T00:00:00Z" }),
      { ...ready, id: "b" },
      { ...ready, id: "c", status: "HABILITADO" },
      row({ id: "d", createdAt: "2026-10-04T00:00:00Z" }),
    ]);
    expect(g.action.map((r) => r.id)).toEqual(["b"]);
    expect(g.capture.map((r) => r.id)).toEqual(["d", "a"]);
    expect(g.closed.map((r) => r.id)).toEqual(["c"]);
  });
});

describe("enableBlockers", () => {
  it("lista lo que falta para habilitar", () => {
    expect(enableBlockers(row({ biometricConsentAt: null }))).toEqual([
      "el consentimiento del titular",
      "verificar la INE",
      "la prueba de vida",
    ]);
    expect(enableBlockers({ ...ready, ineVerified: true })).toEqual([]);
  });
});

describe("onboardingAuditLine", () => {
  const at = "2026-10-05T16:31:00Z";
  it("la prueba de vida sin motor dice 'motor: ninguno'", () => {
    const l = onboardingAuditLine({ action: "LIVENESS_CAPTURED", actorId: "roberto", createdAt: at, payload: { engine: "noop" } });
    expect(l).toMatchObject({ title: "Prueba de vida capturada", detail: "motor: ninguno", human: false });
  });
  it("habilitar con anulación muestra el modo y el motivo, y cuenta como decisión humana", () => {
    const l = onboardingAuditLine({
      action: "SIGNER_ENABLED",
      actorId: "roberto",
      actorName: "Roberto Díaz",
      createdAt: at,
      payload: { reviewMode: "manual-override", overrideNotes: "El rostro coincide a simple vista" },
    });
    expect(l.human).toBe(true);
    expect(l.actor).toBe("Roberto Díaz");
    expect(l.detail).toBe("modo: anulación manual con motivo · motivo: El rostro coincide a simple vista");
  });
  it("la INE capturada acorta el hash", () => {
    const l = onboardingAuditLine({ action: "INE_CAPTURED", actorId: "r", createdAt: at, payload: { ineHash: "4b1e0000000000000000000000000000000000000000000000000000000ea07c" } });
    expect(l.detail).toBe("hash 4b1e0000…a07c");
  });
  it("una acción desconocida se humaniza", () => {
    expect(onboardingAuditLine({ action: "ALGO_NUEVO", actorId: "r", createdAt: at }).title).toBe("Algo nuevo");
  });
});

describe("enabledReviewMode", () => {
  it("toma el último SIGNER_ENABLED de la auditoría", () => {
    const events = [
      { action: "SIGNER_ENABLED", actorId: "r", createdAt: "1", payload: { reviewMode: "manual" } },
      { action: "SIGNER_ENABLED", actorId: "r", actorName: "Roberto", createdAt: "2", payload: { reviewMode: "engine" } },
    ];
    expect(enabledReviewMode(events)).toEqual({ mode: "engine", notes: undefined, actor: "Roberto" });
  });
  it("sin evento o con modo desconocido, nada", () => {
    expect(enabledReviewMode([])).toBeNull();
    expect(enabledReviewMode([{ action: "SIGNER_ENABLED", actorId: "r", createdAt: "1", payload: { reviewMode: "x" } }])).toBeNull();
  });
});

describe("joinEs", () => {
  it("une listas en español", () => {
    expect(joinEs([])).toBe("");
    expect(joinEs(["a"])).toBe("a");
    expect(joinEs(["a", "b"])).toBe("a y b");
    expect(joinEs(["a", "b", "c"])).toBe("a, b y c");
  });
});
