"use client";

import Link from "next/link";
import { Check, Lock, type LucideIcon } from "lucide-react";

import { cn } from "@/libs/utils";

export interface WizardStep {
  id: string;
  label: string;
  description?: string;
  /** Icono del paso (lucide). Se ve mientras el paso es el actual o está pendiente; al completarse lo reemplaza una palomita. */
  icon?: LucideIcon;
  /** El paso ya tiene lo necesario. */
  done: boolean;
  /** Motivo (en texto) por el que todavía no se puede entrar a este paso. */
  blocked?: string;
  /** Si el paso es un enlace (en lugar de cambiar de paso con `onSelect`). */
  href?: string;
  onNavigate?: (e: React.MouseEvent) => void;
}

/**
 * Indicador de avance de un asistente por pasos, sin fondo ni caja.
 * Cada estado se distingue por forma y color, no solo por color:
 *  - completo: palomita verde y línea verde hasta el siguiente;
 *  - actual: su icono en carbón con una barra verde bajo el nombre (que va en negrita);
 *  - pendiente: icono y nombre en gris.
 * El estado también va en texto para lectores de pantalla. Móvil: «Paso 2 de 5 · Nombre» con barra de progreso.
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
  onSelect?: (index: number) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const active = steps[current];
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <nav aria-label={ariaLabel} className={className}>
      <div className="sm:hidden">
        <p className="text-sm font-semibold" aria-live="polite">
          Paso {current + 1} de {steps.length} <span className="font-normal text-muted-foreground">·</span> {active?.label}
        </p>
        <div
          role="progressbar"
          aria-label="Avance"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          aria-valuetext={`${doneCount} de ${steps.length} pasos completos`}
          className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/15"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
        </div>
      </div>

      <ol className="hidden sm:flex">
        {steps.map((s, i) => {
          const isCurrent = i === current;
          const isDone = s.done && !isCurrent;
          const Icon = s.icon;
          const state = isCurrent ? "paso actual" : s.done ? "completo" : "pendiente";
          const disabled = !!s.blocked && !isCurrent;
          const body = (
            <>
              <span aria-hidden className="flex size-8 items-center justify-center">
                {isDone ? (
                  <Check className="size-7 text-primary" strokeWidth={2.75} />
                ) : Icon ? (
                  <Icon className={cn("size-7 transition-colors", isCurrent ? "text-foreground" : "text-muted-foreground/60 group-enabled:group-hover:text-muted-foreground")} strokeWidth={1.75} />
                ) : (
                  <span className={cn("font-mono text-lg font-semibold", isCurrent ? "text-foreground" : "text-muted-foreground/60")}>{i + 1}</span>
                )}
              </span>
              <span
                className={cn(
                  "relative flex items-center gap-1 pb-1.5 text-sm leading-tight",
                  isCurrent ? "font-semibold text-foreground" : isDone ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {s.blocked && !isCurrent ? <Lock aria-hidden className="size-3.5 shrink-0" /> : null}
                {s.label}
                {isCurrent ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-primary" /> : null}
              </span>
              <span className="sr-only">
                {`, ${state}`}
                {s.blocked ? `. ${s.blocked}` : s.description ? `. ${s.description}` : ""}
              </span>
            </>
          );
          const column =
            "group mx-auto flex min-h-11 w-full max-w-44 flex-col items-center gap-1 rounded-lg px-1 py-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed";
          return (
            <li key={s.id} className="relative flex-1" aria-current={isCurrent ? "step" : undefined}>
              {s.href && !disabled ? (
                <Link href={s.href as never} onClick={s.onNavigate} className={column}>
                  {body}
                </Link>
              ) : onSelect ? (
                <button type="button" disabled={disabled} onClick={() => onSelect(i)} title={s.blocked} className={column}>
                  {body}
                </button>
              ) : (
                <div className={column}>{body}</div>
              )}
              {i < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute left-[calc(50%+1.75rem)] top-5 h-0.5 w-[calc(100%-3.5rem)] -translate-y-1/2 rounded-full",
                    s.done ? "bg-primary" : "bg-foreground/15",
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
