import { describe, expect, it } from "vitest";

import {
  CSV_TEMPLATE,
  detectDelimiter,
  parseAmount,
  parseCsv,
  parseExpenseCsv,
  parseStage,
  validateRow,
  type RawRow,
} from "@/libs/expense-responsibles";

const HEAD = "etapa,area,tipoGasto,concepto,montoMin,montoMax,signerId,nombre,correo";

const raw = (o: Partial<RawRow> = {}): RawRow => ({
  stage: "area",
  area: "Tecnología",
  expenseType: "",
  concept: "",
  minAmount: "",
  maxAmount: "",
  signerId: "ana@x.com",
  name: "Ana",
  email: "ana@x.com",
  ...o,
});

describe("parseStage / parseAmount", () => {
  it("acepta variantes de la etapa", () => {
    expect(parseStage("Area")).toBe("area");
    expect(parseStage("tipo de gasto")).toBe("tipoGasto");
    expect(parseStage("tipo_gasto")).toBe("tipoGasto");
    expect(parseStage("otra")).toBeNull();
  });
  it("convierte montos", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(" $1500.50 ")).toBe(1500.5);
    expect(parseAmount("12,5", true)).toBe(12.5);
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("-3")).toBeNaN();
  });
});

describe("validateRow", () => {
  it("normaliza una fila válida", () => {
    const r = validateRow(raw({ minAmount: "0", maxAmount: "100" }));
    expect(r.errors).toEqual([]);
    expect(r.row).toMatchObject({ stage: "area", expenseType: null, concept: null, minAmount: 0, maxAmount: 100, active: true });
  });
  it("usa el correo como signerId si falta", () => {
    expect(validateRow(raw({ signerId: "" })).row?.signerId).toBe("ana@x.com");
  });
  it("exige tipo de gasto solo en la etapa tipoGasto", () => {
    expect(validateRow(raw({ stage: "tipoGasto" })).errors.join(" ")).toMatch(/tipo de gasto/);
    expect(validateRow(raw({ stage: "tipoGasto", expenseType: "Licencias" })).errors).toEqual([]);
  });
  it("rechaza rango invertido, monto inválido, correo inválido y faltantes", () => {
    const text = validateRow(raw({ minAmount: "10", maxAmount: "5", email: "no", name: "", area: "" })).errors.join("|");
    expect(text).toMatch(/mayor que el máximo/);
    expect(text).toMatch(/correo/);
    expect(text).toMatch(/nombre/);
    expect(text).toMatch(/área/);
    expect(validateRow(raw({ minAmount: "x" })).errors.join(" ")).toMatch(/mínimo no es un número/);
  });
});

describe("parseCsv / detectDelimiter", () => {
  it("detecta el separador por la cabecera", () => {
    expect(detectDelimiter(HEAD)).toBe(",");
    expect(detectDelimiter(HEAD.replaceAll(",", ";"))).toBe(";");
  });
  it("respeta comillas, comillas escapadas, CRLF y BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","di ""hola"""\r\n\r\n', ",");
    expect(rows.map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["x, y", 'di "hola"'],
    ]);
    expect(rows[1]!.line).toBe(2);
  });
});

describe("parseExpenseCsv", () => {
  it("lee con comas", () => {
    const r = parseExpenseCsv(`${HEAD}\narea,Tecnología,,Renta oficinas,0,50000,ana@x.com,Ana,ana@x.com\n`);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ area: "Tecnología", concept: "Renta oficinas", maxAmount: 50000 });
  });
  it("lee con punto y coma y coma decimal", () => {
    const r = parseExpenseCsv(`${HEAD.replaceAll(",", ";")}\r\ntipoGasto;Ventas;Viáticos;;10,5;;luis@x.com;Luis;luis@x.com`);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ stage: "tipoGasto", expenseType: "Viáticos", minAmount: 10.5, maxAmount: null });
  });
  it("acepta cabeceras con otro orden, acentos o mayúsculas", () => {
    const r = parseExpenseCsv("Nombre,CORREO,Etapa,Área,TipoGasto,Concepto,MontoMin,MontoMax,SignerId\nAna,a@x.com,area,TI,,Marketing: Publicidad,,,a@x.com");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: "Ana", area: "TI", concept: "Marketing: Publicidad" });
  });
  it("reporta cabecera incompleta", () => {
    const r = parseExpenseCsv("etapa,area\narea,TI");
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toMatchObject({ line: 1 });
    expect(r.errors[0]!.message).toMatch(/montoMin/);
  });
  it("reporta errores por fila con su número de línea y no devuelve filas", () => {
    const r = parseExpenseCsv(
      [HEAD, "area,TI,,,0,10,a@x.com,Ana,a@x.com", "area,,,,5,1,b@x.com,,b@x.com", "otra,TI,,,,,c@x.com,Cy,c@x.com"].join("\n"),
    );
    expect(r.rows).toEqual([]);
    expect(r.errors.filter((e) => e.line === 2)).toEqual([]);
    expect(r.errors.filter((e) => e.line === 3).map((e) => e.message).join(" ")).toMatch(/Falta el área.*mayor que el máximo.*nombre/);
    expect(r.errors.filter((e) => e.line === 4).map((e) => e.message).join(" ")).toMatch(/etapa/);
  });
  it("rechaza archivo vacío o sin datos", () => {
    expect(parseExpenseCsv("  ").errors[0]!.message).toMatch(/vacío/);
    expect(parseExpenseCsv(HEAD).errors[0]!.message).toMatch(/no tiene filas/);
  });
  it("la plantilla descargable es válida", () => {
    const r = parseExpenseCsv(CSV_TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });
});
