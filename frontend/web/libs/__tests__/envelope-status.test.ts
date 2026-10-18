import { describe, expect, it } from "vitest";
import { auditLabel, groupEnvelopes, shortHash, signerLabel, statusSentence } from "@/libs/envelope-status";
import type { InboxItem } from "@/services/inbox-service";

const base = {
  documentId: "d1",
  documentTitle: "Contrato.pdf",
  caseTitle: "Contrato de arrendamiento",
  requestedByName: "Roberto Díaz",
  methods: ["ACCEPT"],
  createdAt: "2026-10-05T10:00:00Z",
};

function item(over: Partial<InboxItem>): InboxItem {
  return { ...base, signatureRequestId: "r1", status: "EN_FIRMA", myStatus: "PENDIENTE", ...over } as InboxItem;
}

const ana = { signerId: "ana", name: "Ana Ruiz", status: "FIRMADO" };
const carlos = { signerId: "carlos", name: "Carlos Mena", status: "PENDIENTE" };
const lucia = { signerId: "lucia", name: "Lucía Torres", status: "PENDIENTE" };
const trio = [ana, carlos, lucia];

describe("groupEnvelopes", () => {
  it("lo que me toca firmar va a 'requieren tu acción'", () => {
    const g = groupEnvelopes([item({ myTurn: true })], []);
    expect(g.action).toHaveLength(1);
    expect(g.inProgress).toHaveLength(0);
  });

  it("si espero mi turno NO requiere acción: queda en curso", () => {
    const g = groupEnvelopes([item({ myTurn: false })], []);
    expect(g.action).toHaveLength(0);
    expect(g.inProgress).toHaveLength(1);
  });

  it("un sobre cerrado nunca requiere acción, aunque mi estado siga pendiente", () => {
    const g = groupEnvelopes([item({ status: "CANCELADA", myTurn: true })], []);
    expect(g.action).toHaveLength(0);
    expect(g.closed).toHaveLength(1);
  });

  it("el mismo sobre en bandeja y enviados no se duplica y conserva que lo envié yo", () => {
    const g = groupEnvelopes([item({ myTurn: true })], [item({ myStatus: "FIRMADO" })]);
    const all = [...g.action, ...g.inProgress, ...g.closed];
    expect(all).toHaveLength(1);
    expect(all[0]?.mine).toBe(true);
    expect(all[0]?.actionable).toBe(true);
  });

  it("ordena del más reciente al más antiguo dentro de cada grupo", () => {
    const g = groupEnvelopes([], [
      item({ signatureRequestId: "viejo", createdAt: "2026-10-01T00:00:00Z", myStatus: "FIRMADO" }),
      item({ signatureRequestId: "nuevo", createdAt: "2026-10-05T00:00:00Z", myStatus: "FIRMADO" }),
    ]);
    expect(g.inProgress.map((r) => r.signatureRequestId)).toEqual(["nuevo", "viejo"]);
  });

  it("tolera listas vacías o ausentes", () => {
    expect(groupEnvelopes(undefined, undefined)).toEqual({ action: [], inProgress: [], closed: [] });
  });
});

describe("statusSentence", () => {
  it("secuencial: dice a quién se espera y cuántas firmas van", () => {
    expect(
      statusSentence({ status: "EN_FIRMA", order: "SECUENCIAL", currentSignerId: "carlos", signers: trio }),
    ).toBe("Esperando a Carlos Mena · 1 de 3 firmas");
  });

  it("paralelo: cuántas faltan; con una sola, quién falta", () => {
    expect(statusSentence({ status: "EN_FIRMA", order: "PARALELO", signers: trio })).toBe("Faltan 2 de 3 firmas");
    const dos = [ana, carlos];
    expect(statusSentence({ status: "EN_FIRMA", order: "PARALELO", signers: dos })).toBe(
      "Falta Carlos Mena · 1 de 2 firmas",
    );
  });

  it("me toca firmar", () => {
    expect(statusSentence({ status: "EN_FIRMA", actionable: true, signers: trio })).toBe(
      "Te toca firmar · faltan 2 de 3 firmas",
    );
    expect(statusSentence({ status: "EN_FIRMA", actionable: true, signers: [carlos] })).toBe("Te toca firmar");
  });

  it("estados cerrados dicen lo que pasó, con el nombre de quien rechazó", () => {
    const rech = [{ signerId: "c", name: "Carlos Mena", status: "RECHAZADO" }];
    expect(statusSentence({ status: "RECHAZADA", signers: rech })).toBe("Rechazado por Carlos Mena");
    expect(statusSentence({ status: "COMPLETADA", signers: trio.map((s) => ({ ...s, status: "FIRMADO" })) })).toBe(
      "Firmas completas (3 de 3)",
    );
    expect(statusSentence({ status: "CANCELADA", signers: trio })).toBe("Cancelado por el remitente");
    expect(statusSentence({ status: "EXPIRADA", signers: trio })).toBe("Venció con 1 de 3 firmas");
  });

  it("sin firmantes no inventa un conteo", () => {
    expect(statusSentence({ status: "EN_FIRMA", signers: [] })).toBe("Sin firmantes");
  });
});

describe("shortHash / signerLabel / auditLabel", () => {
  it("acorta un hash largo con puntos suspensivos y no toca uno corto o vacío", () => {
    expect(shortHash("9f3a7c1b" + "0".repeat(50) + "c21e")).toBe("9f3a7c1b…c21e");
    expect(shortHash("abc")).toBe("abc");
    expect(shortHash(null)).toBe("—");
  });

  it("el nombre del firmante cae al id si falta", () => {
    expect(signerLabel({ signerId: "ana", name: "  ", status: "PENDIENTE" })).toBe("ana");
    expect(signerLabel({ signerId: "ana", name: "Ana Ruiz", status: "PENDIENTE" })).toBe("Ana Ruiz");
  });

  it("etiqueta en español los eventos conocidos y humaniza los desconocidos", () => {
    expect(auditLabel("DOC_FROZEN")).toBe("Documento congelado");
    expect(auditLabel("ALGO_NUEVO_RARO")).toBe("Algo nuevo raro");
  });
});
