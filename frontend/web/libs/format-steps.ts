import type { FormatKind, ResolvedStep } from "@/services/formats-service";

/* Lógica pura de la lista «Se enviará a» y de las etiquetas del tipo de formato (sin React, para probarla). */

/** Un formato digital (`FORM`) no es un PDF subido: se nombra por lo que es. Sin `kind` (servidores previos) es PDF. */
export const kindLabel = (kind?: FormatKind | null): string => (kind === "FORM" ? "Formato digital" : "PDF");

/** Texto corto para la hoja del icono de documento (nunca «PDF» para un formato digital). */
export const kindIconLabel = (kind?: FormatKind | null): string => (kind === "FORM" ? "FORM" : "PDF");

type StepWho = Pick<ResolvedStep, "who" | "unresolved" | "awaiting">;

/** Un paso `lookup` cuyos datos de entrada aún no están completos: la persona se asigna al terminar de llenar. */
export const isAwaiting = (s: StepWho): boolean => s.who.type === "lookup" && (s.awaiting?.length ?? 0) > 0;

/**
 * El paso necesita que quien usa el formato elija a la persona: «ask», o «lookup» cuyos datos ya están completos y la
 * tabla no devolvió a nadie (`unresolved`). Un paso que espera datos NO pide persona.
 */
export const needsPerson = (s: StepWho): boolean =>
  s.who.type === "ask" || (s.who.type === "lookup" && s.unresolved === true && !isAwaiting(s));

/** «Se asignará al llenar: Área del solicitante, Monto». Vacío si el paso no espera datos. */
export function awaitingText(s: Pick<ResolvedStep, "awaiting">): string {
  const labels = (s.awaiting ?? []).map((a) => a.label || a.key).filter(Boolean);
  return labels.length ? `Se asignará al llenar: ${labels.join(", ")}` : "";
}

export interface NumberedStep {
  /** Posición entre los pasos que aplican (desde 1). */
  number: number;
  step: ResolvedStep;
}

export interface StepGroups {
  /** Los que aplican, en su orden original y numerados. */
  applicable: NumberedStep[];
  /** Los que no aplican con estos datos, en su orden original. */
  skipped: ResolvedStep[];
}

/** Separa los pasos que aplican (primero, numerados) de los que no aplican; nunca descarta ninguno. */
export function groupSteps(steps: readonly ResolvedStep[]): StepGroups {
  const applicable: NumberedStep[] = [];
  const skipped: ResolvedStep[] = [];
  for (const step of steps) {
    if (step.active) applicable.push({ number: applicable.length + 1, step });
    else skipped.push(step);
  }
  return { applicable, skipped };
}

/** «1 paso no aplica con estos datos» / «15 pasos no aplican con estos datos». */
export const skippedSummary = (n: number): string => (n === 1 ? "1 paso no aplica con estos datos" : `${n} pasos no aplican con estos datos`);
