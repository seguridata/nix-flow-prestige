import { describe, expect, it } from "vitest";

import { resolveAllowedMethods } from "@/libs/allowed-methods";

describe("resolveAllowedMethods", () => {
  it("sin allowedMethodsNow conserva todos los métodos (compatibilidad)", () => {
    expect(resolveAllowedMethods(["DIGITAL", "AUTOGRAFA"], undefined)).toEqual({
      methods: ["DIGITAL", "AUTOGRAFA"],
      hiddenSome: false,
    });
  });

  it("filtra y marca que se ocultó alguno", () => {
    expect(resolveAllowedMethods(["DIGITAL", "AUTOGRAFA", "ACCEPT"], ["DIGITAL", "ACCEPT"])).toEqual({
      methods: ["DIGITAL", "ACCEPT"],
      hiddenSome: true,
    });
  });

  it("si coinciden no hay aviso", () => {
    expect(resolveAllowedMethods(["DIGITAL"], ["DIGITAL"]).hiddenSome).toBe(false);
  });
});
