export const DEFAULT_DEV_TENANT = "seguridata";

let warned = false;

/**
 * Resuelve el tenant del claim `tenant` del token. En producción un claim
 * ausente es un error (sesión inválida): nunca se asume un tenant. Fuera de
 * producción se conserva el fallback de desarrollo con un aviso (una sola vez).
 */
export function resolveTenant(
  claim: string | null | undefined,
  production: boolean = process.env.NODE_ENV === "production",
): string {
  const value = typeof claim === "string" ? claim.trim() : "";
  if (value) return value;
  if (production) throw new Error("El token no trae el claim 'tenant'");
  if (!warned) {
    warned = true;
    console.warn(`[auth] el token no trae el claim 'tenant'; usando '${DEFAULT_DEV_TENANT}' (solo desarrollo)`);
  }
  return DEFAULT_DEV_TENANT;
}

/** Solo para pruebas. */
export function resetTenantWarning(): void {
  warned = false;
}
