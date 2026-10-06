import { signerLabel, statusSentence, type EnvelopeGroups, type EnvelopeRow } from "@/libs/envelope-status";

/** Lo que `/operations/overview` marca como atención (solo se leen estos campos). */
export interface OverviewAttention {
  slaRisk: { id: string; documentId: string; status: string; expiresAt: string | null; requestedByName: string | null }[];
  overdueTasks: { id: string; name: string; dueAt: string | null }[];
  reviewOnboarding: { id: string; fullName: string; status: string }[];
  brokenRuns: { id: string; workflowId: string; status: string; lastError: string | null }[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * La frase que abre el home: lo que hoy pide algo del operador, en orden de urgencia.
 * Sin pendientes dice que está al día; nunca queda un titular vacío.
 */
export function headline(counts: { sign: number; review: number; expiring: number; broken: number }): string {
  const parts: string[] = [];
  if (counts.sign > 0) parts.push(`te toca firmar ${plural(counts.sign, "documento", "documentos")}`);
  if (counts.review > 0) parts.push(`${plural(counts.review, "alta espera", "altas esperan")} a RH`);
  if (counts.expiring > 0) parts.push(`${counts.expiring === 1 ? "vence 1 solicitud" : `vencen ${counts.expiring} solicitudes`} en 24 h`);
  if (counts.broken > 0) parts.push(`${plural(counts.broken, "flujo se detuvo", "flujos se detuvieron")}`);
  if (parts.length === 0) return "Todo está al día";
  const text = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type DueTone = "overdue" | "soon" | "normal" | "none";

const hhmm = (d: Date) => d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Hoy 14:00", "Mañana", "En 3 días", "Vencido": el vencimiento en una frase corta y su tono. */
export function dueLabel(expiresAt: string | null | undefined, now: Date = new Date()): { text: string; tone: DueTone } {
  if (!expiresAt) return { text: "Sin vencimiento", tone: "none" };
  const due = new Date(expiresAt);
  if (Number.isNaN(due.getTime())) return { text: "Sin vencimiento", tone: "none" };
  if (due.getTime() <= now.getTime()) return { text: "Vencido", tone: "overdue" };

  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  const soon = due.getTime() - now.getTime() <= 24 * 3_600_000;
  const tone: DueTone = soon ? "soon" : "normal";
  if (days === 0) return { text: `Hoy ${hhmm(due)}`, tone };
  if (days === 1) return { text: `Mañana ${hhmm(due)}`, tone };
  if (days < 7) return { text: `En ${days} días`, tone };
  return { text: due.toLocaleDateString("es-MX", { day: "numeric", month: "short" }), tone };
}

const byDue = (a: EnvelopeRow, b: EnvelopeRow) => {
  const ta = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const tb = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  return ta - tb;
};

/** Los sobres abiertos que se muestran: primero los que le tocan al usuario y luego por vencimiento más cercano. */
export function openEnvelopes(groups: EnvelopeGroups, limit = 6): EnvelopeRow[] {
  return [...[...groups.action].sort(byDue), ...[...groups.inProgress].sort(byDue)].slice(0, limit);
}

export interface ActionItem {
  id: string;
  kind: "firmar" | "alta" | "flujo";
  title: string;
  detail: string;
  href: string;
  cta: string;
}

/** La cola «Requiere tu acción»: firmas que tocan, altas por revisar y flujos detenidos, en ese orden. */
export function actionQueue(input: {
  sign: EnvelopeRow[];
  review: OverviewAttention["reviewOnboarding"];
  broken: OverviewAttention["brokenRuns"];
}): ActionItem[] {
  return [
    ...input.sign.map<ActionItem>((r) => ({
      id: `firma-${r.signatureRequestId}`,
      kind: "firmar",
      title: `Firmar ${r.caseTitle || r.documentTitle}`,
      detail: statusSentence(r),
      href: `/documents/${r.documentId}/firmar`,
      cta: "Revisar y firmar",
    })),
    ...input.review.map<ActionItem>((r) => ({
      id: `alta-${r.id}`,
      kind: "alta",
      title: `Revisar alta de ${r.fullName}`,
      detail: "Espera la decisión de RH.",
      href: `/onboarding/${r.id}`,
      cta: "Revisar alta",
    })),
    ...input.broken.map<ActionItem>((r) => ({
      id: `flujo-${r.id}`,
      kind: "flujo",
      title: "Un flujo se detuvo",
      detail: r.lastError ? `Detalle: ${r.lastError}` : "Revisa su estado en Operación.",
      href: "/operations",
      cta: "Ver en Operación",
    })),
  ];
}

export { signerLabel };
