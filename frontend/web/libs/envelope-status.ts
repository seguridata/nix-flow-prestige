import type { InboxItem } from "@/services/inbox-service";

/** Estados en los que el sobre ya no admite más firmas. */
const CLOSED = new Set(["COMPLETADA", "RECHAZADA", "CANCELADA", "EXPIRADA"]);

export interface EnvelopeRow extends InboxItem {
  /** El usuario de la bandeja debe firmar ahora (le toca su turno). */
  actionable: boolean;
  /** El usuario de la bandeja es quien envió el sobre. */
  mine: boolean;
}

export interface EnvelopeGroups {
  action: EnvelopeRow[];
  inProgress: EnvelopeRow[];
  closed: EnvelopeRow[];
}

type Signer = NonNullable<InboxItem["signers"]>[number];

export function signerLabel(s: Signer): string {
  return s.name?.trim() || s.signerId;
}

/**
 * Une lo que me toca firmar (`/me/inbox`) con lo que envié (`/me/sent`), sin duplicar
 * el mismo sobre, y lo reparte en tres grupos según lo que el operador debe hacer.
 */
export function groupEnvelopes(inbox: InboxItem[] = [], sent: InboxItem[] = []): EnvelopeGroups {
  const byId = new Map<string, EnvelopeRow>();
  for (const item of sent) {
    byId.set(item.signatureRequestId, { ...item, actionable: false, mine: true });
  }
  for (const item of inbox) {
    const actionable = item.myStatus === "PENDIENTE" && item.myTurn !== false && !CLOSED.has(item.status);
    const prev = byId.get(item.signatureRequestId);
    byId.set(item.signatureRequestId, { ...(prev ?? item), ...item, actionable, mine: prev?.mine ?? false });
  }
  const groups: EnvelopeGroups = { action: [], inProgress: [], closed: [] };
  const rows = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const row of rows) {
    if (row.actionable) groups.action.push(row);
    else if (CLOSED.has(row.status)) groups.closed.push(row);
    else groups.inProgress.push(row);
  }
  return groups;
}

/** Una frase en lenguaje claro que dice en qué punto está el sobre y qué falta. */
export function statusSentence(row: Pick<InboxItem, "status" | "signers" | "currentSignerId" | "order"> & { actionable?: boolean }): string {
  const signers = row.signers ?? [];
  const total = signers.length;
  const signed = signers.filter((s) => s.status === "FIRMADO").length;
  const rejected = signers.find((s) => s.status === "RECHAZADO");

  if (row.status === "COMPLETADA") return total > 0 ? `Firmas completas (${signed} de ${total})` : "Firmas completas";
  if (row.status === "RECHAZADA") return rejected ? `Rechazado por ${signerLabel(rejected)}` : "Rechazado";
  if (row.status === "CANCELADA") return "Cancelado por el remitente";
  if (row.status === "EXPIRADA") return total > 0 ? `Venció con ${signed} de ${total} firmas` : "Venció sin completarse";
  if (row.actionable) return total > 1 ? `Te toca firmar · faltan ${total - signed} de ${total} firmas` : "Te toca firmar";

  const pending = signers.filter((s) => s.status === "PENDIENTE");
  if (total === 0) return "Sin firmantes";
  if (row.order === "SECUENCIAL") {
    const current = signers.find((s) => s.signerId === row.currentSignerId) ?? pending[0];
    return current ? `Esperando a ${signerLabel(current)} · ${signed} de ${total} firmas` : `${signed} de ${total} firmas`;
  }
  const [only] = pending;
  if (pending.length === 1 && only) return `Falta ${signerLabel(only)} · ${signed} de ${total} firmas`;
  return `Faltan ${pending.length} de ${total} firmas`;
}

/** `9f3a7c1b…c21e`: lo bastante largo para reconocerlo, lo bastante corto para leerlo. */
export function shortHash(hash: string | null | undefined, head = 8, tail = 4): string {
  if (!hash) return "—";
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

const AUDIT_LABELS: Record<string, string> = {
  DOC_UPLOADED: "Documento subido",
  DOC_FROZEN: "Documento congelado",
  REQUEST_CREATED: "Sobre enviado a firma",
  CONSENT_ACCEPTED: "Consentimiento aceptado",
  SIGNATURE_APPLIED: "Firma aplicada",
  PASSKEY_ASSERTED: "Passkey verificada",
  REQUEST_REJECTED: "Documento rechazado",
  REQUEST_CANCELLED: "Sobre cancelado",
  REQUEST_COMPLETED: "Todas las firmas completas",
  EVIDENCE_SEALED: "Expediente sellado",
};

/** Etiqueta en español de un evento de auditoría; si no la conocemos, se humaniza el código. */
export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
