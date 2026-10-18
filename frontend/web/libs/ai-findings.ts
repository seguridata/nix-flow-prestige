import type { AiFinding } from "@/services/ai-service";

const ORDER: Record<AiFinding["severity"], number> = { error: 0, warn: 1, info: 2 };

/** Errores primero, luego avisos y sugerencias; dentro de cada nivel, las reglas antes que la opinión de la IA. */
export function sortFindings(findings: readonly AiFinding[]): AiFinding[] {
  return [...findings].sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || (a.source === b.source ? 0 : a.source === "regla" ? -1 : 1),
  );
}

export const SEVERITY_LABEL: Record<AiFinding["severity"], string> = {
  error: "Corregir",
  warn: "Revisar",
  info: "Sugerencia",
};

/** Resumen corto para el encabezado de la revisión. */
export function describeFindings(findings: readonly AiFinding[]): string {
  if (findings.length === 0) return "Sin observaciones. El flujo se ve bien.";
  const errors = findings.filter((f) => f.severity === "error").length;
  const rest = findings.length - errors;
  const parts = [];
  if (errors) parts.push(errors === 1 ? "1 error" : `${errors} errores`);
  if (rest) parts.push(rest === 1 ? "1 observación" : `${rest} observaciones`);
  return parts.join(" y ");
}
