"use client";

import { Check, CircleDashed, Lock, MapPin } from "lucide-react";

import { cn } from "@/libs/utils";

export interface WizardStep {
  id: string;
  label: string;
  description?: string;
  /** El paso ya tiene lo necesario. */
  done: boolean;
  /** Motivo (en texto) por el que todavía no se puede entrar a este paso. */
  blocked?: string;
}

/**
 * Indicador de avance de un asistente por pasos. Escritorio: lista horizontal con círculo numerado o palomita,
 * nombre y estado en texto (Completo / Actual / Pendiente) además del icono y el color. Móvil: «Paso 2 de 5 · Nombre»
 * con barra de progreso. Los botones miden al menos 44px.
 */
export function WizardSteps({
  steps,
  current,
  onSelect,
  className,
}: {
  steps: WizardStep[];
  current: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  const active = steps[current];
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <nav aria-label="Pasos del formato" className={className}>
      <div className="sm:hidden">
        <p className="text-sm font-medium" aria-live="polite">
          Paso {current + 1} de {steps.length} <span className="text-muted-foreground">·</span> {active?.label}
        </p>
        <div
          role="progressbar"
          aria-label="Avance"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          aria-valuetext={`${doneCount} de ${steps.length} pasos completos`}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
        </div>
      </div>

      <ol className="hidden items-stretch gap-2 sm:flex">
        {steps.map((s, i) => {
          const isCurrent = i === current;
          const state = isCurrent ? "Actual" : s.done ? "Completo" : "Pendiente";
          const StateIcon = isCurrent ? MapPin : s.done ? Check : s.blocked ? Lock : CircleDashed;
          return (
            <li key={s.id} className="min-w-0 flex-1" aria-current={isCurrent ? "step" : undefined}>
              <button
                type="button"
                disabled={!!s.blocked && !isCurrent}
                onClick={() => onSelect(i)}
                title={s.blocked}
                className={cn(
                  "flex min-h-14 w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                  isCurrent ? "border-foreground bg-background shadow-elevated" : "border-transparent bg-muted hover:bg-muted/70",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs",
                    s.done && !isCurrent ? "bg-primary text-primary-foreground" : isCurrent ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.done && !isCurrent ? <Check className="size-4" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{s.label}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <StateIcon className="size-3" aria-hidden />
                    {state}
                  </span>
                </span>
                <span className="sr-only">{s.blocked ? `. ${s.blocked}` : s.description ? `. ${s.description}` : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
