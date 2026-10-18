import { describe, expect, it } from "vitest";

import {
  clampPageLimit,
  flattenRows,
  hasMoreRows,
  isFiltering,
  lookupRowsCsv,
  MAX_PAGE_LIMIT,
  NO_FILTERS,
  reflowRows,
  rowCursor,
  rowMatchesFilters,
  rowsAfterAdd,
  rowsAfterMove,
  rowsAfterRemove,
  rowsAfterUpdate,
  rowsQueryString,
  rowsRemaining,
  rowsTotal,
  ROWS_PAGE_SIZE,
  type LookupColumn,
  type LookupRow,
  type MoveResult,
  type RowsData,
} from "@/libs/lookup";

const row = (i: number, extra: Partial<LookupRow> = {}): LookupRow => ({ id: `r${i}`, position: i, active: true, values: { area: `Área ${i}` }, ...extra });
const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => row(from + i));
const ids = (d: RowsData) => flattenRows(d.pages).map((r) => r.id);

/** Páginas como las deja `useInfiniteQuery`: `sizes` filas por página y `more` si el servidor aún tiene más. */
function pagesOf(sizes: number[], total: number, more: boolean): RowsData {
  let at = 0;
  const pages = sizes.map((n, i) => {
    const items = rows(n, at);
    at += n;
    const last = i === sizes.length - 1;
    return { items, total, nextCursor: !last || more ? rowCursor(items[items.length - 1]!) : null };
  });
  return { pages, pageParams: [null, ...pages.slice(0, -1).map((p) => p.nextCursor)] };
}

const move = (id: string, changed: [string, number][], extra: Partial<MoveResult> = {}): MoveResult => ({
  id,
  moved: true,
  index: 1,
  position: 0,
  total: 10,
  revision: 2,
  changed: changed.map(([i, position]) => ({ id: i, position })),
  ...extra,
});

describe("límite de página", () => {
  it("nunca pasa de 200 (lo que acepta el BFF) ni baja de 1; por defecto 50", () => {
    expect(MAX_PAGE_LIMIT).toBe(200);
    expect(ROWS_PAGE_SIZE).toBe(50);
    expect(clampPageLimit(5000)).toBe(200);
    expect(clampPageLimit(500)).toBe(200);
    expect(clampPageLimit(0)).toBe(50);
    expect(clampPageLimit(-3)).toBe(1);
    expect(clampPageLimit(undefined)).toBe(50);
    expect(clampPageLimit(NaN)).toBe(50);
    expect(clampPageLimit(37.9)).toBe(37);
  });

  it("rowsQueryString recorta el límite y manda solo los filtros con valor", () => {
    expect(rowsQueryString()).toBe("limit=50");
    expect(rowsQueryString({ limit: 5000 })).toBe("limit=200");
    expect(rowsQueryString({ cursor: "3:abc", limit: 50, q: "  nómina ", active: "active" })).toBe("cursor=3%3Aabc&limit=50&q=n%C3%B3mina&active=true");
    expect(rowsQueryString({ q: "   ", active: "all" })).toBe("limit=50");
    expect(rowsQueryString({ active: "inactive" })).toBe("limit=50&active=false");
    expect(rowsQueryString({ cursor: null })).toBe("limit=50");
  });

  it("isFiltering: búsqueda con texto o estado distinto de «todas»", () => {
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(isFiltering({ q: "  ", active: "all" })).toBe(false);
    expect(isFiltering({ q: "a", active: "all" })).toBe(true);
    expect(isFiltering({ q: "", active: "inactive" })).toBe(true);
  });
});

describe("páginas cargadas", () => {
  it("flattenRows junta las páginas sin repetir una fila que llegó dos veces (gana la más reciente)", () => {
    const d = pagesOf([2, 2], 10, true);
    d.pages[1]!.items.unshift({ ...row(1), values: { area: "nueva" } });
    expect(flattenRows(d.pages).map((r) => r.id)).toEqual(["r0", "r1", "r2", "r3"]);
    expect(flattenRows(d.pages)[1]!.values.area).toBe("nueva");
  });

  it("hasMoreRows, rowsTotal y rowsRemaining salen de la última página", () => {
    const d = pagesOf([3, 3], 10, true);
    expect(hasMoreRows(d)).toBe(true);
    expect(rowsTotal(d)).toBe(10);
    expect(rowsRemaining(d)).toBe(4);
    expect(hasMoreRows(pagesOf([3], 3, false))).toBe(false);
    expect(rowsRemaining(pagesOf([3], 3, false))).toBe(0);
    expect(hasMoreRows(undefined)).toBe(false);
    expect(rowsRemaining(undefined)).toBe(0);
  });

  it("reflowRows reparte en las mismas páginas, actualiza el total y deja los cursores en la última fila de cada página", () => {
    const d = pagesOf([3, 3], 10, true);
    const out = reflowRows(d, [...flattenRows(d.pages)].reverse(), 10);
    expect(out.pages.map((p) => p.items.map((r) => r.id))).toEqual([["r5", "r4", "r3"], ["r2", "r1", "r0"]]);
    expect(out.pages[0]!.nextCursor).toBe("3:r3");
    expect(out.pages[1]!.nextCursor).toBe("0:r0"); // sigue habiendo más en el servidor
    expect(reflowRows(pagesOf([3], 3, false), rows(3), 3).pages[0]!.nextCursor).toBeNull();
    expect(out.pageParams).toHaveLength(2);
  });
});

describe("mover sin recargar", () => {
  it("subir: las posiciones cambiadas se aplican y la lista se reordena; el total no cambia", () => {
    const d = pagesOf([3, 3], 10, true);
    const out = rowsAfterMove(d, move("r2", [["r2", 1], ["r1", 2]]))!;
    expect(ids(out)).toEqual(["r0", "r2", "r1", "r3", "r4", "r5"]);
    expect(rowsTotal(out)).toBe(10);
    expect(out.pages[0]!.items.map((r) => r.id)).toEqual(["r0", "r2", "r1"]);
    expect(out.pages[1]!.nextCursor).toBe("5:r5"); // cursor de la última fila cargada
  });

  it("«al inicio» desplaza solo las que estaban antes", () => {
    const d = pagesOf([5], 5, false);
    const out = rowsAfterMove(d, move("r3", [["r3", 0], ["r0", 1], ["r1", 2], ["r2", 3]]))!;
    expect(ids(out)).toEqual(["r3", "r0", "r1", "r2", "r4"]);
  });

  it("si el movimiento toca filas que aún no se cargaron devuelve null (hay que recargar)", () => {
    const d = pagesOf([3], 10, true);
    expect(rowsAfterMove(d, move("r2", [["r2", 3], ["r3", 2]]))).toBeNull();
  });

  it("sin cambio (moved:false) deja todo igual", () => {
    const d = pagesOf([3], 3, false);
    expect(rowsAfterMove(d, move("r0", [], { moved: false }))).toBe(d);
  });

  it("el desempate por id mantiene el orden del servidor", () => {
    const d: RowsData = { pages: [{ items: [row(0), row(1)], total: 2, nextCursor: null }], pageParams: [null] };
    const out = rowsAfterMove(d, move("r1", [["r1", 0], ["r0", 0]]))!; // misma posición: gana el id menor
    expect(ids(out)).toEqual(["r0", "r1"]);
  });
});

describe("agregar, editar y borrar respetan lo cargado", () => {
  it("borrar quita la fila y baja el total; los cursores siguen a la última fila", () => {
    const d = pagesOf([3, 3], 10, true);
    const out = rowsAfterRemove(d, "r1");
    expect(ids(out)).toEqual(["r0", "r2", "r3", "r4", "r5"]);
    expect(rowsTotal(out)).toBe(9);
    expect(out.pages.map((p) => p.items.length)).toEqual([3, 2]);
    expect(out.pages[0]!.nextCursor).toBe("3:r3");
    expect(rowsAfterRemove(d, "no-cargada")).toEqual(rowsAfterRemove(d, "no-cargada"));
    expect(rowsTotal(rowsAfterRemove(d, "no-cargada"))).toBe(10);
  });

  it("borrar la última fila cargada de una página con más datos deja el cursor en la anterior", () => {
    const d = pagesOf([2], 5, true);
    const out = rowsAfterRemove(d, "r1");
    expect(ids(out)).toEqual(["r0"]);
    expect(out.pages[0]!.nextCursor).toBe("0:r0");
  });

  it("agregar con todo cargado la pone al final; con más páginas solo sube el total", () => {
    const full = pagesOf([3], 3, false);
    const added = rowsAfterAdd(full, row(3), NO_FILTERS);
    expect(ids(added)).toEqual(["r0", "r1", "r2", "r3"]);
    expect(rowsTotal(added)).toBe(4);
    expect(hasMoreRows(added)).toBe(false);

    const partial = pagesOf([3], 10, true);
    const bumped = rowsAfterAdd(partial, row(10), NO_FILTERS);
    expect(ids(bumped)).toEqual(["r0", "r1", "r2"]);
    expect(rowsTotal(bumped)).toBe(11);
    expect(hasMoreRows(bumped)).toBe(true);
  });

  it("una fila nueva que no cumple el filtro activo no cambia la lista", () => {
    const d = pagesOf([3], 3, false);
    expect(rowsAfterAdd(d, row(3), { q: "", active: "inactive" })).toBe(d);
    expect(rowsAfterAdd(d, row(3), { q: "zzz", active: "all" })).toBe(d);
    expect(rowsTotal(rowsAfterAdd(d, row(3), { q: "área 3", active: "all" }))).toBe(4);
  });

  it("editar reemplaza la fila en su lugar; con el filtro de estado, desactivarla la saca y baja el total", () => {
    const d = pagesOf([3], 3, false);
    const edited = rowsAfterUpdate(d, row(1, { values: { area: "Otra" } }), NO_FILTERS);
    expect(edited.removed).toBe(false);
    expect(flattenRows(edited.data.pages)[1]!.values.area).toBe("Otra");
    expect(rowsTotal(edited.data)).toBe(3);

    const off = rowsAfterUpdate(d, row(1, { active: false }), { q: "", active: "active" });
    expect(off.removed).toBe(true);
    expect(ids(off.data)).toEqual(["r0", "r2"]);
    expect(rowsTotal(off.data)).toBe(2);

    const stays = rowsAfterUpdate(d, row(1, { active: false }), NO_FILTERS);
    expect(stays.removed).toBe(false);
    expect(flattenRows(stays.data.pages)[1]!.active).toBe(false);
    expect(rowsAfterUpdate(d, row(99), NO_FILTERS)).toEqual({ data: d, removed: false });
  });

  it("rowMatchesFilters: sin mayúsculas ni acentos, en cualquier celda, y por estado", () => {
    const r = row(0, { values: { area: "Nómina", n: 5 } });
    expect(rowMatchesFilters(r, { q: "NOMINA", active: "all" })).toBe(true);
    expect(rowMatchesFilters(r, { q: "5", active: "all" })).toBe(true);
    expect(rowMatchesFilters(r, { q: "ventas", active: "all" })).toBe(false);
    expect(rowMatchesFilters(r, { q: "", active: "inactive" })).toBe(false);
    expect(rowMatchesFilters({ ...r, active: false }, { q: "", active: "inactive" })).toBe(true);
  });
});

describe("exportación CSV", () => {
  const cols: LookupColumn[] = [
    { key: "area", label: "Área", type: "text" },
    { key: "monto", label: "Monto", type: "number" },
    { key: "nota", label: "Nota", type: "text" },
  ];

  it("cabecera de claves y filas en orden; entrecomilla lo necesario; celdas vacías quedan vacías", () => {
    const csv = lookupRowsCsv(cols, [
      { id: "a", position: 0, active: true, values: { area: "Nómina, QA", monto: 1500.5, nota: 'dice "hola"' } },
      { id: "b", position: 1, active: true, values: { area: "Ventas" } },
    ]);
    expect(csv.split("\r\n")).toEqual(['area,monto,nota', '"Nómina, QA",1500.5,"dice ""hola"""', "Ventas,,", ""]);
  });

  it("neutraliza fórmulas de Excel en celdas de texto, pero no los números negativos", () => {
    const csv = lookupRowsCsv(cols, [{ id: "a", position: 0, active: true, values: { area: "=1+1", monto: -5, nota: "@SUMA(A1)" } }]);
    expect(csv.split("\r\n")[1]).toBe("'=1+1,-5,'@SUMA(A1)");
  });

  it("sin filas solo trae la cabecera", () => {
    expect(lookupRowsCsv(cols, [])).toBe("area,monto,nota\r\n");
  });
});
