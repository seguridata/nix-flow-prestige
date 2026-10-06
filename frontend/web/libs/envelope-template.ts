import type { SignatureMethod, SigningOrder } from "@/libs/types";

export type KycPolicy = "NONE" | "ONCE" | "EVERY_SIGN";

/** Defaults reutilizables que devuelve `GET /signature-requests/templates`. */
export interface EnvelopeTemplate {
  id: string;
  tenantId: string;
  name: string;
  order: SigningOrder;
  kycPolicy: KycPolicy;
  allowedMethods: SignatureMethod[];
  requirePasskey: boolean;
  slaHours: number;
  createdAt: string;
}

/** Lo que el wizard de envío muestra y manda. Un override explícito gana sobre la plantilla. */
export interface EnvelopeDraft {
  methods: SignatureMethod[];
  sequential: boolean;
  kycPolicy: KycPolicy;
  requirePasskey: boolean;
  slaHours: number;
}

export const ENVELOPE_METHOD_OPTIONS: { value: SignatureMethod; label: string }[] = [
  { value: "DIGITAL", label: "Digital" },
  { value: "AUTOGRAFA", label: "Autógrafa" },
  { value: "BIOMETRICA", label: "Biométrica" },
  { value: "ACCEPT", label: "Acepto" },
  { value: "PASSKEY", label: "Passkey" },
];

export const KYC_OPTIONS: { value: KycPolicy; label: string }[] = [
  { value: "NONE", label: "Sin verificación" },
  { value: "ONCE", label: "Una vez (≤90 días)" },
  { value: "EVERY_SIGN", label: "Cada firma" },
];

export function applyEnvelopeTemplate(template: EnvelopeTemplate): EnvelopeDraft {
  return {
    methods: [...template.allowedMethods],
    sequential: template.order === "SECUENCIAL",
    kycPolicy: template.kycPolicy,
    requirePasskey: template.requirePasskey,
    slaHours: template.slaHours,
  };
}

export function draftToTemplateBody(name: string, draft: EnvelopeDraft) {
  return {
    name: name.trim(),
    order: (draft.sequential ? "SECUENCIAL" : "PARALELO") as SigningOrder,
    kycPolicy: draft.kycPolicy,
    allowedMethods: draft.methods,
    requirePasskey: draft.requirePasskey,
    slaHours: draft.slaHours,
  };
}
