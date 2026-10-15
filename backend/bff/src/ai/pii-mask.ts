/**
 * Enmascara datos personales antes de enviar texto a un modelo externo. No se necesita revertirlo:
 * el modelo solo debe entender la estructura del proceso, no quién es quién.
 * El orden importa: lo más específico (CURP) va antes que lo genérico (RFC, cuentas).
 */
const RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['CURP', /\b[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d\b/g],
  ['CLAVE_ELECTOR', /\b[A-Z]{6}\d{8}[HM]\d{3}\b/g],
  ['RFC', /\b[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}\b/g],
  ['CORREO', /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g],
  ['CUENTA', /\b\d{10,18}\b/g],
];

export interface MaskResult {
  text: string;
  /** Cuántos datos se enmascararon por tipo (para auditoría; nunca los valores). */
  counts: Record<string, number>;
}

export function maskPii(input: string): MaskResult {
  let text = input;
  const counts: Record<string, number> = {};
  for (const [label, re] of RULES) {
    text = text.replace(re, () => {
      counts[label] = (counts[label] ?? 0) + 1;
      return `[${label}]`;
    });
  }
  return { text, counts };
}
