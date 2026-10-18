import { describe, expect, it } from "vitest";

import { awaitingText, groupSteps, isAwaiting, kindIconLabel, kindLabel, needsPerson, skippedSummary } from "@/libs/format-steps";
import type { ResolvedStep } from "@/services/formats-service";

const step = (o: Partial<ResolvedStep> & { stepId: string }): ResolvedStep => ({
  label: o.stepId,
  role: "FIRMANTE",
  who: { type: "initiator" },
  active: true,
  ...o,
});
const lookup = (o: Partial<Omit<ResolvedStep, "who">> & { stepId: string }) => step({ ...o, who: { type: "lookup", prompt: "¿Quién?" } as ResolvedStep["who"] }); // quien llena el formato recibe el lookup sin consulta
const ask = (stepId: string) => step({ stepId, who: { type: "ask", prompt: "¿Quién?" } });

describe("kindLabel / kindIconLabel", () => {
  it("un formato digital nunca se llama PDF", () => {
    expect(kindLabel("FORM")).toBe("Formato digital");
    expect(kindIconLabel("FORM")).toBe("FORM");
    expect(kindIconLabel("FORM")).not.toMatch(/pdf/i);
  });
  it("PDF y servidores sin `kind` siguen siendo PDF", () => {
    expect(kindLabel("PDF")).toBe("PDF");
    expect(kindLabel(undefined)).toBe("PDF");
    expect(kindLabel(null)).toBe("PDF");
    expect(kindIconLabel(undefined)).toBe("PDF");
  });
});

describe("needsPerson / isAwaiting", () => {
  it("«ask» siempre pide persona", () => {
    expect(needsPerson(ask("a"))).toBe(true);
  });
  it("lookup: solo pide persona con `unresolved` (datos completos y sin coincidencia)", () => {
    expect(needsPerson(lookup({ stepId: "l", unresolved: true }))).toBe(true);
    expect(needsPerson(lookup({ stepId: "l" }))).toBe(false);
    expect(needsPerson(lookup({ stepId: "l", resolved: { signerId: "x" } }))).toBe(false);
  });
  it("lookup con `awaiting`: se asignará al llenar, nunca pide persona (aunque llegara también unresolved)", () => {
    const s = lookup({ stepId: "l", awaiting: [{ key: "area", label: "Área del solicitante" }] });
    expect(isAwaiting(s)).toBe(true);
    expect(needsPerson(s)).toBe(false);
    expect(needsPerson({ ...s, unresolved: true })).toBe(false);
  });
  it("`awaiting` vacío no cuenta; un paso que no es lookup no espera", () => {
    expect(isAwaiting(lookup({ stepId: "l", awaiting: [] }))).toBe(false);
    expect(isAwaiting({ ...ask("a"), awaiting: [{ key: "k", label: "K" }] })).toBe(false);
  });
});

describe("awaitingText", () => {
  it("nombra las variables que faltan con la etiqueta del flujo", () => {
    expect(awaitingText({ awaiting: [{ key: "area", label: "Área del solicitante" }] })).toBe("Se asignará al llenar: Área del solicitante");
    expect(
      awaitingText({
        awaiting: [
          { key: "a", label: "Área" },
          { key: "m", label: "Monto" },
        ],
      }),
    ).toBe("Se asignará al llenar: Área, Monto");
  });
  it("usa la clave si no hay etiqueta y devuelve vacío si no se espera nada", () => {
    expect(awaitingText({ awaiting: [{ key: "monto", label: "" }] })).toBe("Se asignará al llenar: monto");
    expect(awaitingText({})).toBe("");
    expect(awaitingText({ awaiting: [] })).toBe("");
  });
});

describe("groupSteps", () => {
  it("los que aplican van primero, en su orden y numerados desde 1; los demás, aparte y sin perderse", () => {
    const steps = [
      step({ stepId: "a" }),
      step({ stepId: "b", active: false }),
      step({ stepId: "c" }),
      step({ stepId: "d", active: false }),
      step({ stepId: "e" }),
    ];
    const g = groupSteps(steps);
    expect(g.applicable.map((x) => [x.number, x.step.stepId])).toEqual([
      [1, "a"],
      [2, "c"],
      [3, "e"],
    ]);
    expect(g.skipped.map((s) => s.stepId)).toEqual(["b", "d"]);
    expect(g.applicable.length + g.skipped.length).toBe(steps.length);
  });
  it("sin pasos o con todos activos / todos inactivos", () => {
    expect(groupSteps([])).toEqual({ applicable: [], skipped: [] });
    expect(groupSteps([step({ stepId: "a" })]).skipped).toEqual([]);
    const none = groupSteps([step({ stepId: "a", active: false })]);
    expect(none.applicable).toEqual([]);
    expect(none.skipped).toHaveLength(1);
  });
  it("conserva los pasos con persona por elegir y los que esperan datos entre los que aplican", () => {
    const g = groupSteps([lookup({ stepId: "w", awaiting: [{ key: "k", label: "K" }] }), lookup({ stepId: "u", unresolved: true }), step({ stepId: "x", active: false })]);
    expect(g.applicable.map((x) => x.step.stepId)).toEqual(["w", "u"]);
    expect(g.applicable.filter((x) => needsPerson(x.step)).map((x) => x.step.stepId)).toEqual(["u"]);
  });
  it("no muta la lista de entrada", () => {
    const steps = [step({ stepId: "a", active: false }), step({ stepId: "b" })];
    const copy = structuredClone(steps);
    groupSteps(steps);
    expect(steps).toEqual(copy);
  });
});

describe("skippedSummary", () => {
  it("concuerda en singular y plural", () => {
    expect(skippedSummary(1)).toBe("1 paso no aplica con estos datos");
    expect(skippedSummary(15)).toBe("15 pasos no aplican con estos datos");
  });
});
