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

/**
 * Separa los métodos que el firmante puede usar de los que el sobre permite pero ya no aplican,
 * para poder explicarlos en lugar de esconderlos sin decir nada.
 */
export function splitMethods<T extends string>(
  methods: readonly T[],
  allowedNow?: readonly T[] | null,
): { usable: T[]; unavailable: T[] } {
  if (!allowedNow) return { usable: [...methods], unavailable: [] };
  return {
    usable: methods.filter((m) => allowedNow.includes(m)),
    unavailable: methods.filter((m) => !allowedNow.includes(m)),
  };
}
