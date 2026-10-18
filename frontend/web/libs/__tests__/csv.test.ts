import { describe, expect, it } from "vitest";

import { csvEscape, detectDelimiter, parseCsv, toCsv } from "@/libs/csv";

describe("detectDelimiter", () => {
  it("coma, punto y coma y tabulador", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
  it("gana el que más aparece en la cabecera; sin ninguno, coma; ignora lo entrecomillado", () => {
    expect(detectDelimiter("a;b;c,d")).toBe(";");
    expect(detectDelimiter("solo")).toBe(",");
    expect(detectDelimiter('"a,b,c";d')).toBe(";");
    expect(detectDelimiter("﻿a;b")).toBe(";");
  });
  it("en empate se prefiere tabulador y luego punto y coma", () => {
    expect(detectDelimiter("a\tb;c")).toBe("\t");
    expect(detectDelimiter("a;b,c")).toBe(";");
  });
});

describe("parseCsv", () => {
  it("comillas, comillas escapadas, saltos dentro de comillas y número de línea", () => {
    const rows = parseCsv('a,b\r\n"x, y","dice ""hi"""\r\n"uno\ndos",z\r\nlast,row', ",");
    expect(rows.map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["x, y", 'dice "hi"'],
      ["uno\ndos", "z"],
      ["last", "row"],
    ]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3, 5]);
  });
  it("salta filas totalmente vacías y quita el BOM", () => {
    const rows = parseCsv("﻿a;b\n\n;\nx;y\n", ";");
    expect(rows.map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["x", "y"],
    ]);
  });
  it("tabulador: lo que pega Excel", () => {
    expect(parseCsv("a\tb\n1\t\n", "\t").map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });
});

describe("toCsv", () => {
  it("entrecomilla solo lo necesario", () => {
    expect(csvEscape("simple")).toBe("simple");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('di "hola"')).toBe('"di ""hola"""');
    expect(toCsv([["a", "b,c"], ["1", "2"]])).toBe('a,"b,c"\r\n1,2\r\n');
  });
});
