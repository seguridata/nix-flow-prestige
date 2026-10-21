"use client";

import { cn } from "@/libs/utils";

export interface FilterOption<T extends string> {
  id: T;
  label: string;
  count: number;
}

/**
 * Filtro simple por estado con conteos. Es un grupo de botones (no pestañas): cambia la lista que
 * se ve, no navega. El botón activo se distingue por relleno y por `aria-pressed`, no solo por color.
 */
export function StatusFilter<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              active
                ? "border-foreground bg-foreground font-medium text-background"
                : "border-border bg-background text-foreground hover:bg-muted",
            )}
          >
            {o.label}
            <span className={cn("tabular-nums", active ? "text-background/80" : "text-muted-foreground")}>{o.count}</span>
          </button>
        );
      })}
    </div>
  );
}
