import { describe, expect, it } from "vitest";

import { signerBlockedBy } from "@/libs/signing-turn";
import type { Signer } from "@/libs/types";

function s(signerId: string, status: Signer["status"], extra: Partial<Signer> = {}): Signer {
  return { signerId, status, signedAt: null, ...extra };
}

const seq = (signers: Signer[]) => ({ order: "SECUENCIAL" as const, signers });
const par = (signers: Signer[]) => ({ order: "PARALELO" as const, signers });

describe("signerBlockedBy", () => {
  it("paralelo: nunca bloquea", () => {
    const r = par([s("ana", "PENDIENTE"), s("beto", "PENDIENTE")]);
    expect(signerBlockedBy(r, "beto")).toBeNull();
  });

  it("secuencial: el primer firmante nunca está bloqueado", () => {
    const r = seq([s("ana", "PENDIENTE"), s("beto", "PENDIENTE")]);
    expect(signerBlockedBy(r, "ana")).toBeNull();
  });

  it("secuencial: el 2º está bloqueado mientras el 1º sigue PENDIENTE", () => {
    const r = seq([s("ana", "PENDIENTE"), s("beto", "PENDIENTE")]);
    expect(signerBlockedBy(r, "beto")?.signerId).toBe("ana");
  });

  it("secuencial: el 2º queda libre cuando el 1º ya firmó", () => {
    const r = seq([s("ana", "FIRMADO"), s("beto", "PENDIENTE")]);
    expect(signerBlockedBy(r, "beto")).toBeNull();
  });

  it("secuencial: el 3º ve al primer anterior pendiente (beto), no a ana", () => {
    const r = seq([s("ana", "FIRMADO"), s("beto", "PENDIENTE"), s("caro", "PENDIENTE")]);
    expect(signerBlockedBy(r, "caro")?.signerId).toBe("beto");
  });

  it("reconoce al firmante por delegación", () => {
    const r = seq([s("ana", "PENDIENTE"), s("beto", "PENDIENTE", { delegatedTo: "supl" })]);
    expect(signerBlockedBy(r, "supl")?.signerId).toBe("ana");
  });

  it("firmante que no está en la solicitud → null", () => {
    const r = seq([s("ana", "PENDIENTE"), s("beto", "PENDIENTE")]);
    expect(signerBlockedBy(r, "ajeno")).toBeNull();
  });
});
