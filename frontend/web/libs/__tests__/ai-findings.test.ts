import { describe, expect, it } from "vitest";
import { describeFindings, sortFindings } from "../ai-findings";
import type { AiFinding } from "@/services/ai-service";

const f = (id: string, severity: AiFinding["severity"], source: AiFinding["source"] = "regla"): AiFinding => ({ id, severity, source, title: id, detail: "" });

describe("sortFindings", () => {
  it("ordena errores, avisos y sugerencias, con reglas antes que IA", () => {
    const out = sortFindings([f("i", "info"), f("w-ia", "warn", "ia"), f("e", "error"), f("w", "warn")]);
    expect(out.map((x) => x.id)).toEqual(["e", "w", "w-ia", "i"]);
  });

  it("no modifica el arreglo original", () => {
    const input = [f("i", "info"), f("e", "error")];
    sortFindings(input);
    expect(input.map((x) => x.id)).toEqual(["i", "e"]);
  });
});

describe("describeFindings", () => {
  it("sin hallazgos", () => {
    expect(describeFindings([])).toBe("Sin observaciones. El flujo se ve bien.");
  });
  it("cuenta errores y observaciones con singular y plural", () => {
    expect(describeFindings([f("e", "error")])).toBe("1 error");
    expect(describeFindings([f("e", "error"), f("e2", "error"), f("w", "warn")])).toBe("2 errores y 1 observación");
    expect(describeFindings([f("w", "warn"), f("i", "info")])).toBe("2 observaciones");
  });
});
