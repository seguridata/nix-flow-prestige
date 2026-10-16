import { describe, expect, it } from "vitest";

import {
  columnKeyFrom,
  describeCondition,
  describeFailure,
  describeQuery,
  guessPersonColumns,
  LOOKUP_OP_LABEL,
  lookupCsvTemplate,
  opNeedsSource,
  OP_ORDER,
  opsForColumn,
  parseCell,
  parseDate,
  parseLookupImport,
  parseNumber,
  parseOptions,
  queryProblems,
  rowValuesFromTexts,
  validateColumns,
  type LookupColumn,
  type LookupQuery,
} from "@/libs/lookup";

const COLUMNS: LookupColumn[] = [
  { key: "area", label: "Área", type: "select", options: ["Tecnología", "Finanzas", "Ventas"] },
  { key: "concepto", label: "Concepto", type: "text" },
  { key: "monto_min", label: "Monto mínimo", type: "number" },
  { key: "vigencia", label: "Vigencia", type: "date" },
  { key: "correo", label: "Correo", type: "text" },
];
const table = { columns: COLUMNS, active: true, name: "Responsables" };
const ctx = { table, sources: [{ key: "area_sol", label: "Área solicitante" }, { key: "monto", label: "Monto" }], where: "Paso 1" };

describe("operadores", () => {
  it("hay 14 y cada uno tiene su etiqueta en español", () => {
    expect(OP_ORDER).toHaveLength(14);
    expect(OP_ORDER.map((o) => LOOKUP_OP_LABEL[o])).toEqual([
      "es igual a",
      "es diferente de",
      "mayor que",
      "mayor o igual que",
      "menor que",
      "menor o igual que",
      "contiene",
      "no contiene",
      "empieza con",
      "termina con",
      "está en la lista",
      "no está en la lista",
      "está vacío",
      "no está vacío",
    ]);
  });
  it("comparar es solo de números y fechas", () => {
    for (const t of ["number", "date"] as const) {
      const ops = opsForColumn(t);
      expect(ops).toEqual(expect.arrayContaining(["gt", "gte", "lt", "lte", "eq", "neq", "in", "isEmpty"]));
      expect(ops).not.toContain("contains");
      expect(ops).not.toContain("startsWith");
    }
  });
  it("buscar texto es solo de texto; la lista de opciones solo admite igualdad, lista y vacío", () => {
    expect(opsForColumn("text")).toEqual(expect.arrayContaining(["contains", "notContains", "startsWith", "endsWith", "eq", "in"]));
    expect(opsForColumn("text")).not.toContain("gt");
    expect(opsForColumn("select")).toEqual(["eq", "neq", "in", "notIn", "isEmpty", "isNotEmpty"]);
  });
  it("«está vacío» y «no está vacío» no llevan fuente", () => {
    expect(opNeedsSource("isEmpty")).toBe(false);
    expect(opNeedsSource("isNotEmpty")).toBe(false);
    expect(opNeedsSource("eq")).toBe(true);
  });
});

describe("esquema de columnas", () => {
  it("claves con la regla de las variables, únicas y con opciones en las listas", () => {
    expect(validateColumns(COLUMNS)).toEqual([]);
    const text = validateColumns([
      { key: "1mal", label: "A", type: "text" },
      { key: "dup", label: "B", type: "text" },
      { key: "dup", label: "C", type: "text" },
      { key: "sel", label: "Lista", type: "select", options: [" "] },
      { key: "ok", label: "", type: "text" },
    ]).join("|");
    expect(text).toMatch(/la clave debe empezar con letra/);
    expect(text).toMatch(/«dup» está repetida|«C»: la clave «dup» está repetida/);
    expect(text).toMatch(/necesita al menos una opción/);
    expect(text).toMatch(/Pon nombre a la columna 5/);
    expect(validateColumns([])).toContain("Agrega al menos una columna.");
  });
  it("máximo 30 columnas", () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ key: `c${i}`, label: `C${i}`, type: "text" as const }));
    expect(validateColumns(many).join(" ")).toMatch(/Máximo 30 columnas/);
  });
  it("la clave nace de la etiqueta, sin acentos y sin repetirse", () => {
    expect(columnKeyFrom("Monto máximo")).toBe("monto_maximo");
    expect(columnKeyFrom("2024 total")).toBe("c_2024_total");
    expect(columnKeyFrom("***")).toBe("columna");
    expect(columnKeyFrom("Área", ["area", "area_2"])).toBe("area_3");
  });
  it("las opciones se limpian: sin vacías ni repetidas (sin distinguir acentos ni mayúsculas)", () => {
    expect(parseOptions("Tecnología, tecnologia ; Ventas\n  , ")).toEqual(["Tecnología", "Ventas"]);
  });
});

describe("celdas", () => {
  it("números: miles con coma, coma decimal con punto y coma, inválidos", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("$1,234.50")).toBe(1234.5);
    expect(parseNumber("1.234,50", true)).toBe(1234.5);
    expect(parseNumber("12,5", true)).toBe(12.5);
    expect(parseNumber("-3")).toBe(-3);
    expect(parseNumber("abc")).toBeNaN();
  });
  it("fechas: ISO y DD/MM/AAAA; las imposibles se rechazan", () => {
    expect(parseDate("2026-01-31")).toBe("2026-01-31");
    expect(parseDate("31/01/2026")).toBe("2026-01-31");
    expect(parseDate("5-3-2026")).toBe("2026-03-05");
    expect(parseDate("31/02/2026")).toBeUndefined();
    expect(parseDate("mañana")).toBeUndefined();
    expect(parseDate(" ")).toBeNull();
  });
  it("parseCell normaliza por tipo", () => {
    expect(parseCell(COLUMNS[0]!, " tecnologia ")).toEqual({ value: "Tecnología" });
    expect(parseCell(COLUMNS[0]!, "Legal").error).toMatch(/no está entre las opciones/);
    expect(parseCell(COLUMNS[2]!, "1500")).toEqual({ value: 1500 });
    expect(parseCell(COLUMNS[2]!, "x").error).toMatch(/número/);
    expect(parseCell(COLUMNS[3]!, "01/02/2026")).toEqual({ value: "2026-02-01" });
    expect(parseCell(COLUMNS[1]!, "")).toEqual({ value: null });
    expect(parseCell(COLUMNS[1]!, "x".repeat(501)).error).toMatch(/500/);
  });
  it("una fila no envía las celdas vacías y reporta cada error con el nombre de su columna", () => {
    const ok = rowValuesFromTexts(COLUMNS, { area: "Finanzas", monto_min: "0", concepto: "" });
    expect(ok.errors).toEqual([]);
    expect(ok.values).toEqual({ area: "Finanzas", monto_min: 0 });
    const bad = rowValuesFromTexts(COLUMNS, { monto_min: "x", vigencia: "ayer" });
    expect(bad.errors.map((e) => e.message)).toEqual([
      "Monto mínimo: no es un número válido.",
      "Vigencia: no es una fecha válida (usa AAAA-MM-DD o DD/MM/AAAA).",
    ]);
  });
});

describe("constructor de condiciones (queryProblems)", () => {
  const q = (match: LookupQuery["match"], tableKey = "responsables"): LookupQuery => ({ table: tableKey, match });
  it("una consulta correcta no tiene problemas", () => {
    expect(
      queryProblems(
        q([
          { column: "area", op: "eq", source: { var: "area_sol" } },
          { column: "monto_min", op: "lte", source: { var: "monto" }, emptyMatchesAny: true },
          { column: "concepto", op: "isEmpty" },
        ]),
        ctx,
      ),
    ).toEqual([]);
  });
  it("exige tabla y al menos una condición", () => {
    expect(queryProblems(q([], ""), ctx)).toEqual(["Paso 1: elige la tabla de consulta."]);
    expect(queryProblems(q([]), ctx)).toEqual(["Paso 1: agrega al menos una condición para consultar la tabla."]);
  });
  it("la columna debe existir y admitir el operador", () => {
    expect(queryProblems(q([{ column: "", op: "eq", source: { value: "x" } }]), ctx).join()).toMatch(/elige la columna/);
    expect(queryProblems(q([{ column: "zzz", op: "eq", source: { value: "x" } }]), ctx).join()).toMatch(/la columna «zzz» ya no existe/);
    expect(queryProblems(q([{ column: "area", op: "gt", source: { value: "x" } }]), ctx).join()).toMatch(/«mayor que» no se puede usar con la columna «Área»/);
    expect(queryProblems(q([{ column: "monto_min", op: "contains", source: { value: "1" } }]), ctx).join()).toMatch(/no se puede usar/);
  });
  it("la fuente: obligatoria salvo en «vacío», variable existente o valor fijo no vacío y numérico", () => {
    expect(queryProblems(q([{ column: "area", op: "eq" }]), ctx).join()).toMatch(/elige con qué se compara/);
    expect(queryProblems(q([{ column: "area", op: "eq", source: { var: "" } }]), ctx).join()).toMatch(/elige el dato del formulario/);
    expect(queryProblems(q([{ column: "area", op: "eq", source: { var: "borrada" } }]), ctx).join()).toMatch(/el dato usado ya no existe/);
    expect(queryProblems(q([{ column: "area", op: "eq", source: { value: "  " } }]), ctx).join()).toMatch(/falta el valor fijo/);
    expect(queryProblems(q([{ column: "monto_min", op: "gte", source: { value: "abc" } }]), ctx).join()).toMatch(/debe ser un número/);
    expect(queryProblems(q([{ column: "monto_min", op: "gte", source: { value: 0 } }]), ctx)).toEqual([]);
    expect(queryProblems(q([{ column: "area", op: "isNotEmpty" }]), ctx)).toEqual([]);
  });
  it("avisa si la tabla está desactivada", () => {
    expect(
      queryProblems(q([{ column: "area", op: "eq", source: { value: "Ventas" } }]), { ...ctx, table: { ...table, active: false } }).join(),
    ).toMatch(/desactivada/);
  });
  it("sin tabla cargada solo valida lo que no depende de las columnas", () => {
    expect(queryProblems(q([{ column: "cualquiera", op: "eq", source: { value: "x" } }]), { ...ctx, table: undefined })).toEqual([]);
  });
});

describe("descripciones", () => {
  it("lee «valor de la solicitud» OPERADOR «columna»", () => {
    expect(describeCondition({ column: "area", op: "eq", source: { var: "area_sol" } }, COLUMNS, ctx.sources)).toBe("Área solicitante es igual a Área");
    expect(describeCondition({ column: "monto_min", op: "gte", source: { value: 100 } }, COLUMNS)).toBe("«100» mayor o igual que Monto mínimo");
    expect(describeCondition({ column: "concepto", op: "isEmpty" }, COLUMNS)).toBe("Concepto está vacío");
    expect(describeQuery({ table: "t", match: [] })).toBe("la primera fila");
  });
  it("explica por qué falló una fila, con índice o con clave de columna", () => {
    const query: LookupQuery = { table: "t", match: [{ column: "area", op: "eq", source: { var: "area_sol" } }, { column: "monto_min", op: "lte", source: { value: 5 } }] };
    expect(describeFailure(undefined, query, COLUMNS)).toBe("Coincide");
    expect(describeFailure(1, query, COLUMNS)).toMatch(/^No cumple la condición 2: /);
    expect(describeFailure("area", query, COLUMNS)).toMatch(/^No cumple la condición 1: /);
    expect(describeFailure("vigencia", query, COLUMNS)).toBe("No cumple en la columna «Vigencia»");
  });
  it("propone las columnas de la persona por su nombre", () => {
    expect(guessPersonColumns(COLUMNS)).toEqual({ signerId: "correo", name: undefined, email: "correo" });
    expect(
      guessPersonColumns([
        { key: "signer_id", label: "ID", type: "text" },
        { key: "nombre", label: "Nombre", type: "text" },
        { key: "email", label: "Correo", type: "text" },
      ]),
    ).toEqual({ signerId: "signer_id", name: "nombre", email: "email" });
  });
});

describe("importación (CSV, punto y coma y pegado desde Excel)", () => {
  const COLS = COLUMNS;
  it("CSV con coma, comillas y BOM", () => {
    const text = '﻿Área,Concepto,Monto mínimo\r\nTecnología,"Licencias, software",1000\r\nFinanzas,"dice ""hola""",0\r\n';
    const r = parseLookupImport(text, COLS);
    expect(r.errors).toEqual([]);
    expect(r.delimiter).toBe(",");
    expect(r.rows).toEqual([
      { area: "Tecnología", concepto: "Licencias, software", monto_min: 1000 },
      { area: "Finanzas", concepto: 'dice "hola"', monto_min: 0 },
    ]);
    expect(r.missingColumns).toEqual(["Vigencia", "Correo"]);
  });
  it("punto y coma: la coma es decimal", () => {
    const r = parseLookupImport("area;monto_min\nVentas;1.500,75\nFinanzas;12,5", COLS);
    expect(r.errors).toEqual([]);
    expect(r.delimiter).toBe(";");
    expect(r.rows.map((x) => x.monto_min)).toEqual([1500.75, 12.5]);
  });
  it("pegado desde Excel (tabulador), con celdas vacías y saltos dentro de comillas", () => {
    const text = 'area\tconcepto\tcorreo\nVentas\t"línea 1\nlínea 2"\tana@x.com\nFinanzas\t\t\n';
    const r = parseLookupImport(text, COLS);
    expect(r.errors).toEqual([]);
    expect(r.delimiter).toBe("\t");
    expect(r.rows).toEqual([{ area: "Ventas", concepto: "línea 1\nlínea 2", correo: "ana@x.com" }, { area: "Finanzas" }]);
  });
  it("valida TODO y lista los errores por línea, sin devolver filas", () => {
    const r = parseLookupImport("area,monto_min,vigencia\nLegal,5,2026-01-01\nVentas,x,2026-01-01\nFinanzas,1,31/02/2026", COLS);
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([
      "2: Área: «Legal» no está entre las opciones.",
      "3: Monto mínimo: no es un número válido.",
      "4: Vigencia: no es una fecha válida (usa AAAA-MM-DD o DD/MM/AAAA).",
    ]);
  });
  it("cabecera: columnas desconocidas, repetidas o ninguna reconocida", () => {
    expect(parseLookupImport("area,rara\nVentas,1", COLS).errors[0]).toEqual({ line: 1, message: "La columna «rara» de la cabecera no existe en la tabla." });
    expect(parseLookupImport("area,Área\nVentas,Ventas", COLS).errors[0]!.message).toMatch(/aparece más de una vez/);
    expect(parseLookupImport("uno,dos\n1,2", COLS).errors[0]!.message).toMatch(/primera fila debe ser la cabecera/);
  });
  it("texto vacío, solo cabecera, más celdas que la cabecera y demasiadas filas", () => {
    expect(parseLookupImport("   ", COLS).errors[0]!.message).toMatch(/vacío/);
    expect(parseLookupImport("area", COLS).errors[0]).toEqual({ line: 0, message: "El archivo no tiene filas de datos." });
    expect(parseLookupImport("area,concepto\nVentas,a,b", COLS).errors[0]!.message).toMatch(/trae 3 celdas y la cabecera 2/);
    const big = "area\n" + "Ventas\n".repeat(5001);
    expect(parseLookupImport(big, COLS).errors.some((e) => /máximo por tabla es 5000/.test(e.message))).toBe(true);
  });
  it("la cabecera acepta claves o etiquetas, sin importar acentos ni mayúsculas", () => {
    const r = parseLookupImport("AREA,CONCEPTO\nVentas,x", COLS);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ area: "Ventas", concepto: "x" }]);
  });
  it("la plantilla se vuelve a leer sin errores", () => {
    const tpl = lookupCsvTemplate(COLS);
    expect(tpl.split("\r\n")[0]).toBe("area,concepto,monto_min,vigencia,correo");
    const r = parseLookupImport(tpl, COLS);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });
});
