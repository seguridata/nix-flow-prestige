import { describe, expect, it } from "vitest";

import { checkRows, custodyLabel, verdictOf, type ServerChecks } from "@/libs/evidence-checks";

const allGood: ServerChecks = {
  documentHash: true,
  presentedHash: true,
  signedHash: true,
  packageHash: true,
  chainOfCustody: true,
  manifestSignature: true,
  timestamp: true,
  auditChain: true,
  eventTimestamps: true,
};

describe("checkRows", () => {
  it("una fila por comprobación que el servidor devolvió, en su orden", () => {
    const rows = checkRows(allGood);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({ id: "documentHash", state: "pass" });
    expect(rows.at(-1)).toMatchObject({ id: "eventTimestamps", state: "pass" });
  });

  it("lo que el servidor marca 'sin-…' no aplica: no se da por aprobado", () => {
    const rows = checkRows({ ...allGood, timestamp: "sin-sello", manifestSignature: "sin-firma", eventTimestamps: "sin-sellos" });
    expect(rows.filter((r) => r.state === "absent").map((r) => r.id)).toEqual([
      "manifestSignature",
      "timestamp",
      "eventTimestamps",
    ]);
  });

  it("una comprobación en falso queda como fallida con su explicación", () => {
    const [row] = checkRows({ documentHash: false });
    expect(row).toMatchObject({ id: "documentHash", state: "fail" });
    expect(row?.description).toContain("ya no coincide");
  });

  it("no inventa filas que el servidor no devolvió (servidores sin desglose)", () => {
    expect(checkRows(undefined)).toEqual([]);
    expect(checkRows({ auditChain: true })).toHaveLength(1);
  });
});

describe("verdictOf", () => {
  it("sin resultado todavía: verificando, nunca íntegro", () => {
    expect(verdictOf(null).kind).toBe("checking");
  });

  it("íntegro solo si el servidor dijo valid, y cuenta lo que aplica", () => {
    const v = verdictOf({ valid: true, mismatches: [], checks: allGood });
    expect(v).toMatchObject({ kind: "intact", title: "Íntegro: 9 de 9 comprobaciones pasaron" });
  });

  it("declara aparte lo que no aplica en lugar de contarlo como aprobado", () => {
    const v = verdictOf({ valid: true, mismatches: [], checks: { ...allGood, timestamp: "sin-sello", eventTimestamps: "sin-sellos" } });
    expect(v.title).toBe("Íntegro: 7 de 7 comprobaciones pasaron");
    expect(v.detail).toContain("2 no aplican");
  });

  it("con valid en falso nunca dice íntegro, aunque las filas parezcan buenas", () => {
    const v = verdictOf({ valid: false, mismatches: ["x"], checks: allGood });
    expect(v.kind).toBe("failed");
    expect(v.title).not.toContain("Íntegro");
  });

  it("cuenta cuántas comprobaciones fallaron", () => {
    const v = verdictOf({ valid: false, mismatches: ["a", "b"], checks: { ...allGood, documentHash: false, auditChain: false } });
    expect(v.detail).toContain("2 comprobaciones fallaron");
  });

  it("un servidor sin desglose igual da un veredicto honesto", () => {
    expect(verdictOf({ valid: true, mismatches: [] })).toMatchObject({ kind: "intact", title: "Íntegro" });
    expect(verdictOf({ valid: false, mismatches: ["x"] }).kind).toBe("failed");
  });
});

describe("custodyLabel", () => {
  it("traduce la firma y humaniza lo demás", () => {
    expect(custodyLabel("SIGNATURE_APPLIED")).toBe("Firma aplicada");
    expect(custodyLabel("OTRO_EVENTO")).toBe("Otro evento");
  });
});
