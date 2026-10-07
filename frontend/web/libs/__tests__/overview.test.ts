import { describe, expect, it } from "vitest";

import type { EnvelopeRow } from "@/libs/envelope-status";
import { actionQueue, dueLabel, headline, openEnvelopes } from "@/libs/overview";

const NOW = new Date(2026, 9, 6, 11, 40); // 6 oct 2026, 11:40 (hora local)
const at = (days: number, h: number, m = 0) => new Date(2026, 9, 6 + days, h, m).toISOString();

describe("headline", () => {
  it("dice que todo está al día cuando no hay pendientes", () => {
    expect(headline({ sign: 0, review: 0, expiring: 0, broken: 0 })).toBe("Todo está al día");
  });
  it("une las partes en orden de urgencia con singular y plural", () => {
    expect(headline({ sign: 2, review: 1, expiring: 0, broken: 0 })).toBe("Te toca firmar 2 documentos y 1 alta espera a RH");
    expect(headline({ sign: 1, review: 3, expiring: 2, broken: 1 })).toBe(
      "Te toca firmar 1 documento, 3 altas esperan a RH, vencen 2 solicitudes en 24 h y 1 flujo se detuvo",
    );
  });
  it("una sola parte va sin conjunción", () => {
    expect(headline({ sign: 0, review: 0, expiring: 1, broken: 0 })).toBe("Vence 1 solicitud en 24 h");
  });
});

describe("dueLabel", () => {
  it("sin fecha o fecha inválida", () => {
    expect(dueLabel(null, NOW)).toEqual({ text: "Sin vencimiento", tone: "none" });
    expect(dueLabel("no-es-fecha", NOW)).toEqual({ text: "Sin vencimiento", tone: "none" });
  });
  it("vencido", () => {
    expect(dueLabel(at(0, 10), NOW)).toEqual({ text: "Vencido", tone: "overdue" });
  });
  it("hoy y mañana llevan la hora; dentro de 24 h es 'soon'", () => {
    expect(dueLabel(at(0, 14), NOW)).toEqual({ text: "Hoy 14:00", tone: "soon" });
    expect(dueLabel(at(1, 9), NOW)).toEqual({ text: "Mañana 09:00", tone: "soon" });
    expect(dueLabel(at(1, 18), NOW)).toEqual({ text: "Mañana 18:00", tone: "normal" });
  });
  it("días y fecha corta", () => {
    expect(dueLabel(at(3, 12), NOW)).toEqual({ text: "En 3 días", tone: "normal" });
    expect(dueLabel(at(20, 12), NOW).text).toMatch(/^\d{1,2} \w+/);
  });
});

const row = (id: string, over: Partial<EnvelopeRow> = {}): EnvelopeRow => ({
  signatureRequestId: id,
  documentId: `d-${id}`,
  documentTitle: `Doc ${id}.pdf`,
  caseTitle: `Caso ${id}`,
  requestedByName: "Ana",
  status: "EN_FIRMA",
  myStatus: "PENDIENTE",
  methods: [],
  createdAt: "2026-10-05T00:00:00Z",
  actionable: false,
  mine: false,
  ...over,
});

describe("openEnvelopes", () => {
  it("primero lo que te toca y dentro de cada grupo el vencimiento más cercano; sin fecha al final", () => {
    const out = openEnvelopes(
      {
        action: [row("a1", { expiresAt: at(2, 9) }), row("a2", { expiresAt: at(0, 15) })],
        inProgress: [row("p1"), row("p2", { expiresAt: at(1, 10) })],
        closed: [row("c1")],
      },
      10,
    );
    expect(out.map((r) => r.signatureRequestId)).toEqual(["a2", "a1", "p2", "p1"]);
  });
  it("respeta el límite y no incluye cerrados", () => {
    const groups = { action: [], inProgress: [row("1"), row("2"), row("3")], closed: [row("c")] };
    expect(openEnvelopes(groups, 2)).toHaveLength(2);
  });
});

describe("actionQueue", () => {
  it("ordena firmas, altas y flujos, y arma los enlaces", () => {
    const items = actionQueue({
      sign: [row("s1", { actionable: true })],
      review: [{ id: "o1", fullName: "Marcos Pérez", status: "REVISION" }],
      broken: [{ id: "w1", workflowId: "wf", status: "FALLIDO", lastError: null }],
    });
    expect(items.map((i) => i.kind)).toEqual(["firmar", "alta", "flujo"]);
    expect(items[0]).toMatchObject({ title: "Firmar Caso s1", href: "/documents/d-s1/firmar", cta: "Revisar y firmar" });
    expect(items[1]).toMatchObject({ title: "Revisar alta de Marcos Pérez", href: "/onboarding/o1" });
    expect(items[2]).toMatchObject({ href: "/operations", detail: "Revisa su estado en Operación." });
  });
  it("sin nada pendiente la cola queda vacía", () => {
    expect(actionQueue({ sign: [], review: [], broken: [] })).toEqual([]);
  });
});
