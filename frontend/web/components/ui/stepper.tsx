"use client";

import { cn } from "@/libs/utils";

export function Stepper({
  steps,
  current,
}: {
  steps: { id: string; label: string }[];
  current: number;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-full font-mono text-xs",
                done && "bg-primary text-primary-foreground",
                active && "bg-secondary text-secondary-foreground",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span className={cn("text-sm", active ? "font-medium text-foreground" : "text-muted-foreground")}>
              {step.label}
            </span>
            {index < steps.length - 1 ? <span className="mx-1 h-px w-6 bg-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
