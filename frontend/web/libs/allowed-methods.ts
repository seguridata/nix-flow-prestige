/**
 * Métodos de firma usables hoy. El BFF manda `allowedMethodsNow` (ya filtrado
 * según el estado del PDF); si no viene (BFF anterior) se usan `methods`.
 */
export const HIDDEN_VISUAL_METHODS_NOTICE =
  "Este documento ya tiene firma digital: las firmas visibles ya no se pueden agregar.";

export function resolveAllowedMethods<T extends string>(
  methods: readonly T[],
  allowedNow?: readonly T[] | null,
): { methods: T[]; hiddenSome: boolean } {
  if (!allowedNow) return { methods: [...methods], hiddenSome: false };
  const visible = methods.filter((m) => allowedNow.includes(m));
  return { methods: visible, hiddenSome: visible.length < methods.length };
}
