import { describe, expect, it } from "vitest";

import { placeField, syncFields, unplacedVariables } from "@/libs/format-draft";
import type { FlowVariable } from "@/libs/flow";
import type { FormatField } from "@/services/formats-service";

const nombre: FlowVariable = { key: "nombre", label: "Nombre", type: "text", required: true };
const dias: FlowVariable = { key: "dias", label: "Días", type: "number", required: false };
const box = { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.04 };

describe("placeField", () => {
  it("coloca una variable una sola vez y conserva el formato al recolocarla", () => {
    const first = placeField([], nombre, box);
    const withFont = first.map((f) => ({ ...f, fontSize: 14, prefill: "user.name" as const }));
    const again = placeField(withFont, nombre, { ...box, y: 0.5 });
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ key: "nombre", y: 0.5, fontSize: 14, prefill: "user.name" });
  });
});

describe("syncFields", () => {
  const fields: FormatField[] = [...placeField([], nombre, box), ...placeField([], dias, { ...box, y: 0.3 })];

  it("quita los campos de variables que ya no existen", () => {
    expect(syncFields(fields, [nombre]).map((f) => f.key)).toEqual(["nombre"]);
  });

  it("copia etiqueta, tipo y obligatoriedad desde la variable", () => {
    const renamed = syncFields(fields, [{ ...nombre, label: "Nombre completo", required: false }, dias]);
    expect(renamed[0]).toMatchObject({ label: "Nombre completo", required: false });
  });

  it("solo las listas llevan opciones", () => {
    const lista: FlowVariable = { key: "tipo", label: "Tipo", type: "select", required: true, options: ["A", "B"] };
    const [f] = syncFields(placeField([], lista, box), [lista]);
    expect(f!.options).toEqual(["A", "B"]);
    const [g] = syncFields(placeField([], lista, box), [{ ...lista, type: "text" }]);
    expect(g!.options).toBeUndefined();
  });
});

describe("unplacedVariables", () => {
  it("lista las variables sin lugar en el documento", () => {
    expect(unplacedVariables(placeField([], nombre, box), [nombre, dias]).map((v) => v.key)).toEqual(["dias"]);
  });
});
