import { describe, expect, it } from "vitest";

import { resolveAllowedMethods, splitMethods } from "@/libs/allowed-methods";

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

describe("splitMethods", () => {
  it("sin allowedMethodsNow todo es usable", () => {
    expect(splitMethods(["DIGITAL", "AUTOGRAFA"], undefined)).toEqual({
      usable: ["DIGITAL", "AUTOGRAFA"],
      unavailable: [],
    });
  });

  it("separa los métodos que ya no aplican para poder explicarlos", () => {
    expect(splitMethods(["ACCEPT", "PASSKEY", "AUTOGRAFA"], ["ACCEPT", "PASSKEY"])).toEqual({
      usable: ["ACCEPT", "PASSKEY"],
      unavailable: ["AUTOGRAFA"],
    });
  });
});
