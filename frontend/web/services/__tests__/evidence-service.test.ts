import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchEvidenceForRequest } from "@/services/evidence-service";

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  );
}

describe("fetchEvidenceForRequest", () => {
  it("devuelve null cuando el BFF responde 404 (sin evidencia o ajena)", async () => {
    mockFetch(404, { message: "Evidencia no encontrada para esta solicitud" });
    await expect(fetchEvidenceForRequest("sr-1")).resolves.toBeNull();
  });

  it("devuelve el manifiesto en 200", async () => {
    mockFetch(200, { manifestId: "m1" });
    await expect(fetchEvidenceForRequest("sr-1")).resolves.toEqual({ manifestId: "m1" });
  });

  it("propaga otros errores", async () => {
    mockFetch(500, { message: "boom" });
    await expect(fetchEvidenceForRequest("sr-1")).rejects.toThrow();
  });
});
