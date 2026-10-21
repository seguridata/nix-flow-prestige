import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/libs/utils";

/**
 * Encabezado común de página: una sola jerarquía en todo el producto.
 * - `back`: vuelve al listado padre (nunca hay callejón sin salida).
 * - `title`: qué es esto. `description`: para qué sirve o qué hacer aquí.
 * - `actions`: la acción principal va primero y es la única con relleno.
 */
export function PageHeader({
  title,
  description,
  back,
  meta,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  back?: { href: string; label: string };
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-8 flex flex-col gap-4", className)}>
      {back ? (
        <Link
          href={back.href as Route}
          className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-[65ch] text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
              {description}
            </p>
          ) : null}
          {meta ? <div className="mt-3 text-sm text-muted-foreground">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
