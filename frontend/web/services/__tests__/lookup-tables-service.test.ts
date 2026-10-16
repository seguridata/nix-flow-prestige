import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_PAGE_LIMIT } from "@/libs/lookup";
import { fetchAllLookupRows, fetchLookupRows, moveLookupRow } from "@/services/lookup-tables-service";

afterEach(() => vi.unstubAllGlobals());

/** El BFF simulado: una tabla de `n` filas paginada por cursor que RECHAZA límites mayores a 200, como el real. */
function fakeBff(n: number) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const u = new URL(url, "http://x");
    const limit = Number(u.searchParams.get("limit") ?? 50);
    if (limit > 200) return Response.json({ message: "limit must not be greater than 200" }, { status: 400 });
    const after = u.searchParams.get("cursor");
    const start = after ? Number(after.split(":")[0]) + 1 : 0;
    const items = Array.from({ length: Math.min(limit, n - start) }, (_, i) => ({ id: `r${start + i}`, position: start + i, active: true, values: {} }));
    const last = items[items.length - 1];
    return Response.json({ items, nextCursor: last && start + items.length < n ? `${last.position}:${last.id}` : null, total: n });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

describe("fetchLookupRows", () => {
  it("nunca pide más de 200 por página, aunque se le pida más", async () => {
    const { calls } = fakeBff(10);
    await fetchLookupRows("t1", { limit: 5000 });
    expect(calls[0]!.url).toBe("/api/bff/lookup-tables/t1/rows?limit=200");
  });

  it("manda cursor, búsqueda y estado al servidor", async () => {
    const { calls } = fakeBff(10);
    await fetchLookupRows("t1", { cursor: "4:r4", limit: 50, q: "nómina", active: "inactive" });
    const u = new URL(calls[0]!.url, "http://x");
    expect(u.pathname).toBe("/api/bff/lookup-tables/t1/rows");
    expect(Object.fromEntries(u.searchParams)).toEqual({ cursor: "4:r4", limit: "50", q: "nómina", active: "false" });
  });

  it("escapa el id de la tabla", async () => {
    const { calls } = fakeBff(1);
    await fetchLookupRows("a/b");
    expect(calls[0]!.url).toContain("/lookup-tables/a%2Fb/rows");
  });
});

describe("fetchAllLookupRows (exportación)", () => {
  it("recorre todas las páginas por cursor de 200 en 200, en orden, sin repetir, y avisa el progreso", async () => {
    const { calls } = fakeBff(450);
    const progress: { loaded: number; total: number }[] = [];
    const rows = await fetchAllLookupRows("t1", { onProgress: (p) => progress.push(p) });
    expect(rows).toHaveLength(450);
    expect(new Set(rows.map((r) => r.id)).size).toBe(450);
    expect(rows[0]!.id).toBe("r0");
    expect(rows[449]!.id).toBe("r449");
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(Number(new URL(c.url, "http://x").searchParams.get("limit"))).toBeLessThanOrEqual(MAX_PAGE_LIMIT);
    expect(progress).toEqual([{ loaded: 200, total: 450 }, { loaded: 400, total: 450 }, { loaded: 450, total: 450 }]);
  });

  it("5000 filas son 25 peticiones", async () => {
    const { calls } = fakeBff(5000);
    expect(await fetchAllLookupRows("t1")).toHaveLength(5000);
    expect(calls).toHaveLength(25);
  });

  it("una tabla vacía devuelve [] con una sola petición", async () => {
    const { calls } = fakeBff(0);
    expect(await fetchAllLookupRows("t1")).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("se puede cancelar entre páginas (AbortError) y no sigue pidiendo", async () => {
    const { calls } = fakeBff(1000);
    const ctl = new AbortController();
    await expect(fetchAllLookupRows("t1", { signal: ctl.signal, onProgress: () => ctl.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(1);
  });

  it("si el servidor devuelve un cursor que no avanza, se detiene en vez de ciclar", async () => {
    const fetchMock = vi.fn(async () => Response.json({ items: [{ id: "x", position: 0, active: true, values: {} }], nextCursor: "0:x", total: 99 }));
    vi.stubGlobal("fetch", fetchMock);
    const rows = await fetchAllLookupRows("t1");
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("propaga el error del servidor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "boom" }, { status: 500 })));
    await expect(fetchAllLookupRows("t1")).rejects.toThrow();
  });
});

describe("moveLookupRow", () => {
  it("hace POST a rows/:rowId/move con la forma pedida", async () => {
    const { calls, fetchMock } = fakeBff(1);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ id: "r1", moved: true, index: 1, position: 0, total: 3, revision: 2, changed: [] });
    });
    await moveLookupRow("t1", "r1", { direction: "up" });
    await moveLookupRow("t1", "r1", { toTop: true });
    await moveLookupRow("t1", "r1", { afterRowId: null });
    expect(calls.map((c) => [c.url, c.init?.method, c.init?.body])).toEqual([
      ["/api/bff/lookup-tables/t1/rows/r1/move", "POST", '{"direction":"up"}'],
      ["/api/bff/lookup-tables/t1/rows/r1/move", "POST", '{"toTop":true}'],
      ["/api/bff/lookup-tables/t1/rows/r1/move", "POST", '{"afterRowId":null}'],
    ]);
  });
});
