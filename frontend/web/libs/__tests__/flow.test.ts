import { describe, expect, it } from "vitest";

import { allVariables, describeWhen, describeWho, emptyFlow, flowProblems, opsFor, optionsFor, pruneDependencies, slugKey, type Flow, type LookupWho } from "@/libs/flow";
import type { LookupQuery, LookupTableSummary } from "@/libs/lookup";

const base = (): Flow => ({
  ...emptyFlow(),
  variables: [{ key: "dias", label: "Días de vacaciones", type: "number", required: true }],
});

const query = (): LookupQuery => ({
  table: "responsables",
  match: [{ column: "monto_min", op: "gte", source: { var: "dias" } }],
});
const lookupWho = (over: Partial<LookupWho> = {}): LookupWho => ({
  type: "lookup",
  query: query(),
  person: { signerId: "correo", name: "nombre" },
  prompt: "¿Quién autoriza?",
  ...over,
});
const tables = (): LookupTableSummary[] => [
  {
    id: "t1",
    key: "responsables",
    name: "Responsables",
    description: null,
    revision: 1,
    active: true,
    rowCount: 3,
    columns: [
      { key: "monto_min", label: "Monto mínimo", type: "number" },
      { key: "correo", label: "Correo", type: "text" },
      { key: "nombre", label: "Nombre", type: "text" },
    ],
  },
];

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
    // Un usuario no administrador recibe el participante «lookup» sin la consulta: no debe romper la pantalla de llenado.
    expect(describeWho({ type: "lookup", prompt: "¿Quién autoriza?" } as unknown as LookupWho)).toBe(
      "Se asigna automáticamente según los datos del formato",
    );
  });
  it("describe el participante según una tabla de consulta", () => {
    expect(describeWho(lookupWho(), { tableNames: { responsables: "Responsables de gasto" }, variables: base().variables })).toBe(
      "Según la tabla «Responsables de gasto»: Días de vacaciones mayor o igual que monto_min",
    );
    expect(describeWho(lookupWho())).toMatch(/^Según la tabla «responsables»: /);
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
  it("un paso lookup exige pregunta de respaldo, persona y condiciones", () => {
    const f = base();
    f.steps = [{ id: "m", label: "Autoriza el área", who: lookupWho({ prompt: "  " }), role: "FIRMANTE" }];
    expect(flowProblems(f).join(" ")).toMatch(/la tabla no encuentra a nadie/);
    f.steps[0]!.who = lookupWho({ person: { signerId: "" } });
    expect(flowProblems(f).join(" ")).toMatch(/columna que identifica a la persona/);
    f.steps[0]!.who = lookupWho({ query: { table: "", match: [] } });
    expect(flowProblems(f).join(" ")).toMatch(/elige la tabla/);
    f.steps[0]!.who = lookupWho({ query: { table: "responsables", match: [] } });
    expect(flowProblems(f).join(" ")).toMatch(/al menos una condición/);
    f.steps[0]!.who = lookupWho();
    expect(flowProblems(f)).toEqual([]);
  });
  it("la fuente de una condición debe ser una variable del formulario que exista", () => {
    const f = base();
    f.steps = [{ id: "m", label: "Autoriza", who: lookupWho({ query: { table: "responsables", match: [{ column: "monto_min", op: "gte", source: { var: "borrada" } }] } }), role: "FIRMANTE" }];
    expect(flowProblems(f).join(" ")).toMatch(/el dato usado ya no existe/);
  });
  it("con las tablas valida que existan, estén activas y que las columnas existan", () => {
    const f = base();
    f.steps = [{ id: "m", label: "Autoriza", who: lookupWho(), role: "FIRMANTE" }];
    expect(flowProblems(f, tables())).toEqual([]);
    expect(flowProblems(f, [])).toEqual([expect.stringMatching(/la tabla «responsables» ya no existe/)]);
    expect(flowProblems(f, [{ ...tables()[0]!, active: false }]).join(" ")).toMatch(/desactivada/);
    f.steps[0]!.who = lookupWho({ person: { signerId: "correo", name: "inexistente" } });
    expect(flowProblems(f, tables()).join(" ")).toMatch(/la columna de nombre «inexistente» ya no existe/);
    f.steps[0]!.who = lookupWho({ query: { table: "responsables", match: [{ column: "zzz", op: "eq", source: { value: "x" } }] } });
    expect(flowProblems(f, tables()).join(" ")).toMatch(/la columna «zzz» ya no existe/);
  });
  it("valida las variables calculadas", () => {
    const f = base();
    f.derived = [{ key: "limite", label: "Límite", type: "number", query: query(), column: "monto_min", onMiss: "empty" }];
    expect(flowProblems(f, tables())).toEqual([]);
    f.derived = [{ key: "dias", label: "Repetida", type: "number", query: query(), column: "" }];
    const text = flowProblems(f, tables()).join("|");
    expect(text).toMatch(/ya la usa otro dato/);
    expect(text).toMatch(/elige la columna que se copia/);
    f.derived = [{ key: "1mal", label: "", type: "text", query: { table: "", match: [] }, column: "x" }];
    const bad = flowProblems(f).join("|");
    expect(bad).toMatch(/variable calculada sin nombre/);
    expect(bad).toMatch(/la clave debe empezar con letra/);
    expect(bad).toMatch(/elige la tabla/);
  });
  it("una variable calculada no puede alimentar a otra consulta de variables, pero sí a una condición de paso", () => {
    const f = base();
    f.derived = [{ key: "limite", label: "Límite", type: "number", query: query(), column: "monto_min" }];
    f.steps[0]!.when = [{ variable: "limite", op: ">", value: 10 }];
    expect(flowProblems(f, tables())).toEqual([]);
    expect(allVariables(f).map((v) => v.key)).toEqual(["dias", "limite"]);
    f.derived.push({
      key: "otra",
      label: "Otra",
      type: "number",
      query: { table: "responsables", match: [{ column: "monto_min", op: "gte", source: { var: "limite" } }] },
      column: "monto_min",
    });
    expect(flowProblems(f, tables()).join(" ")).toMatch(/el dato usado ya no existe/);
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

describe("listas dependientes", () => {
  const tipo = { key: "tipo", label: "Tipo", type: "select" as const, required: true, options: ["A", "B"] };
  const concepto = {
    key: "concepto",
    label: "Concepto",
    type: "select" as const,
    required: true,
    options: ["a1", "a2", "b1"],
    dependsOn: { variable: "tipo", options: { A: ["a1", "a2"], B: ["b1"] } },
  };

  it("ofrece solo las opciones del valor elegido y nada mientras no se elige", () => {
    expect(optionsFor(concepto, { tipo: "A" })).toEqual(["a1", "a2"]);
    expect(optionsFor(concepto, { tipo: "B" })).toEqual(["b1"]);
    expect(optionsFor(concepto, {})).toEqual([]);
    expect(optionsFor(concepto, { tipo: "" })).toEqual([]);
    expect(optionsFor(tipo, {})).toEqual(["A", "B"]);
  });

  it("al editar, descarta lo que ya no es opción y quita la dependencia si el padre dejó de ser lista", () => {
    const pruned = pruneDependencies([{ ...tipo, options: ["A"] }, { ...concepto, options: ["a1", "b1"] }]);
    expect(pruned[1]!.dependsOn).toEqual({ variable: "tipo", options: { A: ["a1"] } });
    const sinPadre = pruneDependencies([{ ...tipo, type: "text" }, concepto]);
    expect(sinPadre[1]!.dependsOn).toBeUndefined();
  });

  it("avisa si una dependencia no es válida o no ofrece nada", () => {
    const flow = (variables: Flow["variables"]): Flow => ({ ...emptyFlow(), steps: [{ id: "p", label: "p", role: "FIRMANTE", who: { type: "initiator" } }], variables });
    expect(flowProblems(flow([tipo, concepto]))).toEqual([]);
    expect(flowProblems(flow([concepto])).join("|")).toContain("depende de una lista que no es válida");
    expect(flowProblems(flow([tipo, { ...concepto, dependsOn: { variable: "tipo", options: { A: [] } } }])).join("|")).toContain("no tiene opciones");
  });
});
