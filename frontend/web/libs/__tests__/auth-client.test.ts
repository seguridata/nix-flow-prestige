import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { authorizeUrl, clientForTenant, endSessionUrl, knownClient } from "@/libs/auth";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("cliente OIDC por tenant", () => {
  it("un tenant con cliente propio usa su client_id; los demás usan el por defecto", () => {
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_TENANT_CLIENTS;
    expect(clientForTenant("tecate")).toBe("prestige-web-tecate");
    expect(clientForTenant("TECATE")).toBe("prestige-web-tecate");
    expect(clientForTenant("seguridata")).toBe("prestige-web");
    expect(clientForTenant(undefined)).toBe("prestige-web");
    expect(clientForTenant(null)).toBe("prestige-web");
  });

  it("la lista es configurable y cerrada: un client_id arbitrario no se acepta", () => {
    process.env.OIDC_TENANT_CLIENTS = "acme=prestige-web-acme, tecate=prestige-web-tecate";
    expect(clientForTenant("acme")).toBe("prestige-web-acme");
    expect(knownClient("prestige-web-acme")).toBe("prestige-web-acme");
    expect(knownClient("prestige-web-tecate")).toBe("prestige-web-tecate");
    expect(knownClient("prestige-web-otro")).toBe("prestige-web");
    expect(knownClient("admin-cli")).toBe("prestige-web");
    expect(knownClient(undefined)).toBe("prestige-web");
  });

  it("authorize y logout llevan el client_id elegido", () => {
    process.env.KEYCLOAK_ISSUER = "http://localhost:8081/realms/prestige";
    const auth = new URL(authorizeUrl("c", "s", undefined, "prestige-web-tecate"));
    expect(auth.searchParams.get("client_id")).toBe("prestige-web-tecate");
    expect(new URL(authorizeUrl("c", "s")).searchParams.get("client_id")).toBe("prestige-web");
    const out = new URL(endSessionUrl("tok", "prestige-web-tecate"));
    expect(out.searchParams.get("client_id")).toBe("prestige-web-tecate");
  });
});
