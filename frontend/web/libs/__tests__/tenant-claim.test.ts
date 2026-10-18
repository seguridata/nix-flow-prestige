import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetTenantWarning, resolveTenant } from "@/libs/tenant-claim";

describe("resolveTenant", () => {
  beforeEach(() => resetTenantWarning());

  it("devuelve el claim cuando existe", () => {
    expect(resolveTenant("acme", true)).toBe("acme");
  });

  it("en producción rechaza un token sin claim", () => {
    expect(() => resolveTenant(undefined, true)).toThrow();
    expect(() => resolveTenant("  ", true)).toThrow();
  });

  it("fuera de producción usa el fallback y avisa una sola vez", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveTenant(undefined, false)).toBe("seguridata");
    expect(resolveTenant(null, false)).toBe("seguridata");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
