import { describe, expect, it } from "vitest";

import { describeWhen, describeWho, emptyFlow, flowProblems, opsFor, slugKey, type Flow } from "@/libs/flow";

const base = (): Flow => ({
  ...emptyFlow(),
  variables: [{ key: "dias", label: "Días de vacaciones", type: "number", required: true }],
});

describe("slugKey", () => {
  it("quita acentos y símbolos", () => {
    expect(slugKey("Días de vacaciones")).toBe("dias_de_vacaciones");
    expect(slugKey("  ¿Nombre?  ")).toBe("nombre");
  });
  it("evita repetidos", () => {
    expect(slugKey("Nombre", ["nombre", "nombre_2"])).toBe("nombre_3");
  });
  it("nunca devuelve vacío", () => {
    expect(slugKey("***")).toBe("campo");
  });
});

describe("describeWhen / describeWho", () => {
  it("lee la condición en lenguaje natural", () => {
    const f = base();
    expect(describeWhen([{ variable: "dias", op: ">", value: 5 }], f.variables)).toBe("Días de vacaciones es mayor que 5");
    expect(describeWhen(undefined, f.variables)).toBe("Siempre");
  });
  it("describe a quién se envía", () => {
    expect(describeWho({ type: "initiator" })).toBe("Quien solicita");
    expect(describeWho({ type: "fixed", signerId: "ana", name: "Ana Ruiz" })).toBe("Ana Ruiz");
    expect(describeWho({ type: "ask", prompt: "Tu jefe directo" })).toBe("Tu jefe directo");
  });
});

describe("opsFor", () => {
  it("solo igualdad para texto y listas; comparaciones para números y fechas", () => {
    expect(opsFor("text")).toEqual(["==", "!="]);
    expect(opsFor("number")).toContain(">");
    expect(opsFor("date")).toContain("<=");
  });
});

describe("flowProblems", () => {
  it("un flujo vacío de problemas no avisa nada", () => {
    expect(flowProblems(base())).toEqual([]);
  });
  it("detecta una condición cuya variable ya no existe", () => {
    const f = base();
    f.steps[0]!.when = [{ variable: "borrada", op: "==", value: "x" }];
    expect(flowProblems(f).join(" ")).toMatch(/ya no existe/);
  });
  it("exige destinatario fijo, pregunta y valores", () => {
    const f = base();
    f.steps = [
      { id: "a", label: "Jefe", who: { type: "fixed", signerId: "" }, role: "FIRMANTE" },
      { id: "b", label: "RH", who: { type: "ask", prompt: "" }, role: "REVISOR", when: [{ variable: "dias", op: ">", value: "" }] },
    ];
    const text = flowProblems(f).join("|");
    expect(text).toMatch(/elige a quién/);
    expect(text).toMatch(/escribe qué se le pregunta/);
    expect(text).toMatch(/falta el valor/);
  });
  it("una lista sin opciones es un problema", () => {
    const f = base();
    f.variables.push({ key: "tipo", label: "Tipo", type: "select", required: true });
    expect(flowProblems(f).join(" ")).toMatch(/al menos una opción/);
  });
  it("sin pasos no se puede guardar", () => {
    const f = base();
    f.steps = [];
    expect(flowProblems(f)).toContain("Agrega al menos un paso.");
  });
});
