import type { FlowVariable } from "@/libs/flow";
import type { FormatField } from "@/services/formats-service";

/**
 * Alinea los campos colocados en el PDF con las variables del flujo: se quitan los de variables que
 * ya no existen y se copian etiqueta, tipo, obligatoriedad y opciones desde la variable (que es la
 * fuente de verdad). La posición y el formato del texto no cambian.
 */
export function syncFields(fields: FormatField[], variables: readonly FlowVariable[]): FormatField[] {
  return fields.flatMap((f) => {
    const v = variables.find((x) => x.key === f.key);
    if (!v) return [];
    return [{ ...f, label: v.label, type: v.type, required: v.required, options: v.type === "select" ? v.options : undefined }];
  });
}

/** Coloca (o recoloca) una variable en el PDF; cada variable ocupa una sola caja. */
export function placeField(
  fields: FormatField[],
  variable: FlowVariable,
  at: { page: number; x: number; y: number; w: number; h: number },
): FormatField[] {
  const previous = fields.find((f) => f.key === variable.key);
  const next: FormatField = {
    key: variable.key,
    label: variable.label,
    type: variable.type,
    required: variable.required,
    options: variable.type === "select" ? variable.options : undefined,
    fontSize: previous?.fontSize ?? 11,
    align: previous?.align ?? "left",
    prefill: previous?.prefill,
    ...at,
  };
  return [...fields.filter((f) => f.key !== variable.key), next];
}

/** Variables que piden un dato pero todavía no tienen lugar en el documento. */
export function unplacedVariables(fields: readonly FormatField[], variables: readonly FlowVariable[]): FlowVariable[] {
  return variables.filter((v) => !fields.some((f) => f.key === v.key));
}
