"use client";

import { Check, Lock, type LucideIcon } from "lucide-react";

import { cn } from "@/libs/utils";

export interface WizardStep {
  id: string;
  label: string;
  description?: string;
  /** Icono grande del paso (lucide). Sin icono se muestra el número. */
  icon?: LucideIcon;
  /** El paso ya tiene lo necesario. */
  done: boolean;
  /** Motivo (en texto) por el que todavía no se puede entrar a este paso. */
  blocked?: string;
}

/**
 * Indicador de avance de un asistente por pasos.
 * Escritorio: un icono grande por paso unido por líneas gruesas (negra el tramo ya recorrido, gris el que falta);
 * verde el paso actual y los completos (con palomita), gris los pendientes; el nombre va en negrita solo si el paso
 * está completo o es el actual. El estado también va en texto para lectores de pantalla (nunca solo color).
 * Móvil: «Paso 2 de 5 · Nombre» con barra de progreso.
 */
export function WizardSteps({
  steps,
  current,
  onSelect,
  ariaLabel = "Pasos",
  className,
}: {
  steps: WizardStep[];
  current: number;
  onSelect: (index: number) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const active = steps[current];
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <nav aria-label={ariaLabel} className={className}>
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

      <ol className="hidden sm:flex">
        {steps.map((s, i) => {
          const isCurrent = i === current;
          const reached = isCurrent || s.done;
          const Icon = s.icon;
          const state = isCurrent ? "paso actual" : s.done ? "completo" : "pendiente";
          return (
            <li key={s.id} className="relative flex-1" aria-current={isCurrent ? "step" : undefined}>
              <button
                type="button"
                disabled={!!s.blocked && !isCurrent}
                onClick={() => onSelect(i)}
                title={s.blocked}
                className="group mx-auto flex min-h-14 w-full max-w-44 flex-col items-center gap-2.5 rounded-xl px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-14 items-center justify-center transition-colors",
                    reached ? "text-primary" : "text-muted-foreground/70 group-enabled:group-hover:text-muted-foreground",
                  )}
                >
                  {Icon ? <Icon className="size-12" strokeWidth={1.4} /> : <span className="font-mono text-3xl font-semibold">{i + 1}</span>}
                </span>
                <span
                  className={cn(
                    "flex items-center justify-center gap-1 text-balance text-center text-sm leading-tight",
                    reached ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.done && !isCurrent ? <Check aria-hidden className="size-4 shrink-0" strokeWidth={3} /> : null}
                  {s.blocked && !isCurrent ? <Lock aria-hidden className="size-3.5 shrink-0" /> : null}
                  {s.label}
                </span>
                <span className="sr-only">
                  {`, ${state}`}
                  {s.blocked ? `. ${s.blocked}` : s.description ? `. ${s.description}` : ""}
                </span>
              </button>
              {i < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute left-[calc(50%+2.5rem)] top-7 h-1.5 w-[calc(100%-5rem)] -translate-y-1/2 rounded-full",
                    i < current ? "bg-foreground" : "bg-foreground/25",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
