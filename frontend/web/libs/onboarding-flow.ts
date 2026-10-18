/**
 * Lógica pura del onboarding de identidad: pasos, quién debe actuar y cómo se lee cada evento de
 * auditoría. Refleja lo que el servidor decide (`enable-policy.ts`), pero nunca lo sustituye: el
 * servidor es quien aplica la regla; aquí solo se anticipa para explicarla.
 */

export type OnboardingStatus =
  | "BORRADOR"
  | "DATOS"
  | "INE"
  | "PRUEBA_VIDA"
  | "EN_REVISION"
  | "HABILITADO"
  | "RECHAZADO";

export interface OnboardingCaseView {
  id: string;
  kind: string;
  status: OnboardingStatus | string;
  fullName: string;
  email: string;
  curp?: string | null;
  rfc?: string | null;
  ineVerified: boolean;
  hasIneFront: boolean;
  hasIneBack: boolean;
  hasSelfie: boolean;
  livenessOk: boolean;
  faceMatchOk: boolean;
  faceMatchScore?: number | null;
  biometricEngine?: string | null;
  enabledSignerId?: string | null;
  notes?: string | null;
  biometricConsentAt?: string | null;
  biometricConsentVersion?: string | null;
  ineHash?: string | null;
  livenessHash?: string | null;
  createdAt: string;
  requestedByName?: string | null;
}

export type ReviewMode = "engine" | "manual" | "manual-override";

const CLOSED = new Set(["HABILITADO", "RECHAZADO"]);

export const isClosed = (row: Pick<OnboardingCaseView, "status">) => CLOSED.has(row.status);
export const hasConsent = (row: Pick<OnboardingCaseView, "biometricConsentAt">) => Boolean(row.biometricConsentAt);
const hasIne = (row: Pick<OnboardingCaseView, "hasIneFront" | "hasIneBack">) => row.hasIneFront && row.hasIneBack;

/** ¿Hay un motor biométrico real? Sin motor (`noop`) la decisión es de RH, como documenta el alta. */
export function hasEngine(row: Pick<OnboardingCaseView, "biometricEngine">): boolean {
  return (row.biometricEngine ?? "noop") !== "noop";
}

/**
 * Qué modo de revisión aplicaría el servidor al habilitar: `engine` si el motor confirmó, `manual`
 * si no hay motor, y `needs-override` si el motor corrió y no pasó (solo se habilita anulando).
 */
export function predictReviewMode(
  row: Pick<OnboardingCaseView, "livenessOk" | "faceMatchOk" | "biometricEngine">,
): ReviewMode | "needs-override" {
  if (row.livenessOk && row.faceMatchOk) return "engine";
  return hasEngine(row) ? "needs-override" : "manual";
}

export const REVIEW_MODE_TEXT: Record<ReviewMode, { label: string; detail: string }> = {
  engine: { label: "Confirmada por el motor biométrico", detail: "El motor confirmó la prueba de vida y el rostro." },
  manual: { label: "Revisión manual", detail: "No había motor biométrico: decidió RH." },
  "manual-override": {
    label: "Anulación manual con motivo",
    detail: "El motor no confirmó y RH habilitó de todos modos, dejando su motivo.",
  },
};

export type BiometricOutcome =
  | { kind: "pending"; title: string; detail: string }
  | { kind: "engine-pass"; title: string; detail: string }
  | { kind: "engine-fail"; title: string; detail: string }
  | { kind: "no-engine"; title: string; detail: string };

/** Lo que dijo (o no dijo) la biometría, sin adornar: sin motor no hay veredicto automático. */
export function biometricOutcome(row: OnboardingCaseView): BiometricOutcome {
  if (!row.hasSelfie) {
    return { kind: "pending", title: "Aún no hay prueba de vida", detail: "Captura la selfie con la cámara para continuar." };
  }
  if (row.livenessOk && row.faceMatchOk) {
    const score = typeof row.faceMatchScore === "number" ? ` (coincidencia ${Math.round(row.faceMatchScore * 100)} %)` : "";
    return {
      kind: "engine-pass",
      title: "El motor confirmó la identidad",
      detail: `Prueba de vida y coincidencia del rostro correctas${score}.`,
    };
  }
  if (!hasEngine(row)) {
    return { kind: "no-engine", title: "Sin motor biométrico configurado", detail: "Revisión manual: la decisión es de RH." };
  }
  return {
    kind: "engine-fail",
    title: "El motor no confirmó la identidad",
    detail: [
      row.livenessOk ? null : "La prueba de vida no pasó.",
      row.faceMatchOk ? null : "El rostro no coincidió con la INE.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export type StepState = "done" | "current" | "todo" | "stopped";

export interface OnboardingStep {
  id: "consent" | "ine" | "liveness" | "review" | "enabled";
  label: string;
  state: StepState;
  /** Lo que realmente pasó (o falta) en este paso. */
  detail: string;
}

/** Los cinco pasos del alta con su estado real. En un alta rechazada lo pendiente queda "detenido". */
export function onboardingSteps(row: OnboardingCaseView): OnboardingStep[] {
  const rejected = row.status === "RECHAZADO";
  const enabled = row.status === "HABILITADO";
  const consent = hasConsent(row);
  const ine = hasIne(row);

  const done = [consent, ine, row.hasSelfie, enabled, enabled];
  const raw: Omit<OnboardingStep, "state">[] = [
    {
      id: "consent",
      label: "Consentimiento",
      detail: consent ? `Aceptado${row.biometricConsentVersion ? `, versión ${row.biometricConsentVersion}` : ""}.` : "Falta el consentimiento del titular.",
    },
    {
      id: "ine",
      label: "INE",
      detail: ine
        ? "Frente y reverso guardados."
        : row.hasIneFront
          ? "Falta el reverso."
          : row.hasIneBack
            ? "Falta el frente."
            : "Falta cargar frente y reverso.",
    },
    { id: "liveness", label: "Prueba de vida", detail: row.hasSelfie ? "Selfie capturada." : "Falta capturar la selfie." },
    {
      id: "review",
      label: "Revisión de RH",
      detail: enabled
        ? "RH tomó la decisión."
        : row.ineVerified
          ? "INE verificada; falta decidir si se habilita."
          : "RH debe verificar la INE y decidir.",
    },
    { id: "enabled", label: "Firma habilitada", detail: enabled ? "La persona ya puede firmar." : "Aún no puede firmar." },
  ];

  let firstOpen = done.findIndex((d) => !d);
  if (firstOpen === -1) firstOpen = done.length;
  return raw.map((step, i) => {
    if (done[i]) return { ...step, state: "done" };
    // Un alta habilitada ya no tiene un paso "en curso": si falta un registro (altas anteriores a
    // la bitácora), se dice sin fingir que está pendiente.
    if (enabled) return { ...step, state: "todo", detail: "Sin registro en el sistema." };
    return { ...step, state: rejected ? "stopped" : i === firstOpen ? "current" : "todo" };
  });
}

/** "a", "a y b", "a, b y c". */
export function joinEs(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Lo que falta para poder habilitar la firma; vacío si ya se puede. */
export function enableBlockers(row: OnboardingCaseView): string[] {
  const out: string[] = [];
  if (!hasConsent(row)) out.push("el consentimiento del titular");
  if (!row.ineVerified) out.push("verificar la INE");
  if (!row.hasSelfie) out.push("la prueba de vida");
  return out;
}

export interface OnboardingNext {
  /** El caso espera una decisión de RH (no solo captura de datos). */
  needsRh: boolean;
  sentence: string;
}

/** Una frase que dice qué sigue, para leer la lista de un vistazo. */
export function nextAction(row: OnboardingCaseView): OnboardingNext {
  if (row.status === "RECHAZADO") return { needsRh: false, sentence: "Alta rechazada" };
  if (row.status === "HABILITADO") {
    return { needsRh: false, sentence: row.enabledSignerId ? `Ya puede firmar como ${row.enabledSignerId}` : "Ya puede firmar" };
  }
  if (!hasConsent(row)) return { needsRh: false, sentence: "Falta el consentimiento del titular" };
  const missing: string[] = [];
  if (!hasIne(row)) missing.push("la INE");
  if (!row.hasSelfie) missing.push("la prueba de vida");
  if (missing.length) return { needsRh: false, sentence: `Falta capturar ${joinEs(missing)}` };
  return {
    needsRh: true,
    sentence: row.ineVerified ? "Tu decisión: habilitar o rechazar" : "Tu decisión: verificar la INE y habilitar",
  };
}

export interface OnboardingGroups {
  action: OnboardingCaseView[];
  capture: OnboardingCaseView[];
  closed: OnboardingCaseView[];
}

/** Reparte las altas por lo que debe hacer RH: decidir, esperar captura, o ya cerradas. */
export function groupOnboarding(rows: OnboardingCaseView[] = []): OnboardingGroups {
  const groups: OnboardingGroups = { action: [], capture: [], closed: [] };
  const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const row of sorted) {
    if (isClosed(row)) groups.closed.push(row);
    else if (nextAction(row).needsRh) groups.action.push(row);
    else groups.capture.push(row);
  }
  return groups;
}

export interface OnboardingAuditEvent {
  action: string;
  actorId: string;
  actorName?: string | null;
  createdAt: string;
  payload?: Record<string, unknown> | null;
}

export interface OnboardingAuditLine {
  title: string;
  /** Datos del evento en una línea corta (nunca PII: el servidor no la guarda en la bitácora). */
  detail?: string;
  /** Decisión humana de RH: se destaca en la línea de tiempo. */
  human: boolean;
  actor: string;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Evento de auditoría del alta en español, con lo que el servidor guardó en su `payload`. */
export function onboardingAuditLine(e: OnboardingAuditEvent): OnboardingAuditLine {
  const p = e.payload ?? {};
  const actor = e.actorName?.trim() || e.actorId;
  const short = (h?: string) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : undefined);

  switch (e.action) {
    case "ONBOARDING_CREATED":
      return { title: "Alta iniciada", human: false, actor };
    case "BIOMETRIC_CONSENT_ACCEPTED": {
      const v = str(p.version) ?? str(p.consentVersion);
      return { title: "Consentimiento biométrico aceptado", detail: v ? `versión ${v}` : undefined, human: false, actor };
    }
    case "INE_CAPTURED":
      return { title: "INE capturada", detail: str(p.ineHash) ? `hash ${short(str(p.ineHash))}` : undefined, human: false, actor };
    case "LIVENESS_CAPTURED": {
      const engine = str(p.engine) ?? "noop";
      return {
        title: "Prueba de vida capturada",
        detail: engine === "noop" ? "motor: ninguno" : `motor: ${engine}`,
        human: false,
        actor,
      };
    }
    case "INE_VERIFIED":
      return { title: p.auto === true ? "INE verificada automáticamente" : "INE verificada por RH", human: p.auto !== true, actor };
    case "INE_CHECK_FAILED":
      return { title: "La verificación de la INE no pasó", human: true, actor };
    case "SIGNER_ENABLED": {
      const mode = str(p.reviewMode) as ReviewMode | undefined;
      const text = mode ? REVIEW_MODE_TEXT[mode] : undefined;
      const notes = str(p.overrideNotes);
      return {
        title: "Firma habilitada",
        detail: [text ? `modo: ${text.label.toLowerCase()}` : undefined, notes ? `motivo: ${notes}` : undefined]
          .filter(Boolean)
          .join(" · ") || undefined,
        human: true,
        actor,
      };
    }
    case "ONBOARDING_REJECTED":
      return { title: "Alta rechazada", detail: str(p.notes), human: true, actor };
    default:
      return {
        title: e.action.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
        human: false,
        actor,
      };
  }
}

/** El modo de revisión con el que se habilitó, tomado del evento SIGNER_ENABLED de la auditoría. */
export function enabledReviewMode(events: OnboardingAuditEvent[]): { mode: ReviewMode; notes?: string; actor: string } | null {
  const e = [...events].reverse().find((x) => x.action === "SIGNER_ENABLED");
  const mode = str(e?.payload?.reviewMode) as ReviewMode | undefined;
  if (!e || !mode || !(mode in REVIEW_MODE_TEXT)) return null;
  return { mode, notes: str(e.payload?.overrideNotes), actor: e.actorName?.trim() || e.actorId };
}
