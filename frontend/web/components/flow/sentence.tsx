"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/libs/utils";

/**
 * Una regla escrita como oración: «Cuando alguien envíe la solicitud, [Quien solicita ▾] [firma ▾]».
 * Cada recuadro gris con subrayado oscuro es editable (abre un popover con el control). Las oraciones se leen
 * de corrido, así que cualquier persona entiende el proceso sin saber qué es un flujo o una condición.
 */
export function SentenceRow({
  n,
  actions,
  children,
  className,
}: {
  n: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <li className={cn("flex flex-wrap items-start gap-x-4 gap-y-2 rounded-2xl border border-border bg-muted/60 p-3.5 sm:flex-nowrap sm:p-4", className)}>
      <span
        aria-hidden
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground font-mono text-xs text-background"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] text-sm leading-[2.3] text-foreground sm:basis-auto sm:text-[15px]">{children}</div>
      {actions ? <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">{actions}</div> : null}
    </li>
  );
}

const chipClass =
  "mx-0.5 inline-flex min-h-7 items-center gap-1 rounded-md border border-border border-b-2 border-b-foreground bg-background px-2.5 py-0 align-baseline text-[13px] font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

/** Recuadro editable. Sin `children` o con `readOnly` es solo texto con el mismo aspecto, sin caret. */
export function SentenceChip({
  label,
  title,
  ariaLabel,
  hideTitle,
  readOnly,
  children,
}: {
  label: React.ReactNode;
  /** Encabezado del popover; también el nombre accesible del recuadro. */
  title: string;
  /** Nombre accesible cuando `label` no es texto plano (por ejemplo lleva un icono). */
  ariaLabel?: string;
  /** Oculta el encabezado del popover cuando el campo de adentro ya dice lo mismo (sigue disponible para lectores de pantalla). */
  hideTitle?: boolean;
  readOnly?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  if (readOnly || !children) {
    return (
      <span className="mx-0.5 inline-flex min-h-7 items-center rounded-md bg-background/70 px-2.5 py-0 align-baseline text-[13px] font-semibold">
        {label}
      </span>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={chipClass} aria-label={ariaLabel ?? `${title}: ${typeof label === "string" ? label : "cambiar"}`}>
        {label}
        <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-3"
        onKeyDown={(e) => {
          // El contenido va en un portal fuera del <form>: Enter en un campo de una línea confirma y cierra.
          const t = e.target as HTMLElement;
          if (e.key === "Enter" && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox") {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        <p className={cn("text-sm font-semibold", hideTitle && "sr-only")}>{title}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export interface RouteStop {
  title: string;
  sub?: string;
}

/** Panel carbón con el recorrido: se ve de un vistazo por dónde viaja la solicitud y hay un único botón con relleno. */
export function RoutePanel({
  title = "Así viajará la solicitud",
  stops,
  children,
  footer,
  className,
}: {
  title?: string;
  stops: RouteStop[];
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <aside
      aria-label={title}
      className={cn("flex min-w-0 flex-col gap-6 rounded-2xl bg-secondary p-6 text-secondary-foreground", className)}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <ol>
        {stops.map((s, i) => (
          <li key={`${i}-${s.title}`} className="flex items-stretch gap-3.5">
            <div className="flex w-4 flex-col items-center">
              <span aria-hidden className="mt-1 size-3.5 shrink-0 rounded-full bg-primary" />
              {i < stops.length - 1 ? <span aria-hidden className="min-h-6 w-0.5 flex-1 bg-white/25" /> : null}
            </div>
            <div className="pb-4">
              <p className="text-[15px] font-semibold">{s.title}</p>
              {s.sub ? <p className="text-[13px] text-white/70">{s.sub}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      {children ? <div className="space-y-2 border-t border-white/20 pt-5">{children}</div> : null}
      {footer ? <div className="mt-auto space-y-3">{footer}</div> : null}
    </aside>
  );
}
