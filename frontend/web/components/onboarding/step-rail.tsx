import { Check, X } from "lucide-react";

import type { OnboardingStep } from "@/libs/onboarding-flow";
import { cn } from "@/libs/utils";

const STATE_TEXT = { done: "listo", current: "ahora", todo: "pendiente", stopped: "detenido" } as const;

/** Nodo del paso: el estado cambia de forma (check, aro grueso, aro, cruz), no solo de color. */
function Node({ state }: { state: OnboardingStep["state"] }) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-[26px] shrink-0 items-center justify-center rounded-full border bg-background",
        state === "done" && "border-primary bg-primary text-primary-foreground",
        state === "current" && "border-2 border-foreground",
        state === "todo" && "border-muted-foreground/50",
        state === "stopped" && "border-foreground bg-foreground text-background",
      )}
    >
      {state === "done" ? <Check className="size-4" strokeWidth={3} aria-hidden /> : null}
      {state === "stopped" ? <X className="size-4" strokeWidth={3} aria-hidden /> : null}
    </span>
  );
}

/**
 * Riel de pasos del alta. En pantallas anchas es horizontal; en móvil pasa a vertical para que
 * etiquetas largas como "Consentimiento" no se encimen. Cada paso dice su estado con texto.
 */
export function StepRail({ steps, label = "Pasos del alta" }: { steps: OnboardingStep[]; label?: string }) {
  return (
    <>
      <ol className="hidden items-start sm:flex" aria-label={label}>
        {steps.map((s, i) => (
          <li key={s.id} className="relative flex min-w-0 flex-1 flex-col items-center text-center" aria-current={s.state === "current" ? "step" : undefined}>
            {i > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1/2 top-[13px] h-px w-full -translate-y-1/2",
                  steps[i - 1]?.state === "done" ? "bg-primary" : "bg-border",
                )}
              />
            ) : null}
            <Node state={s.state} />
            <span className="mt-2 w-full px-0.5 text-sm font-medium leading-tight text-foreground">{s.label}</span>
            <span className="text-xs text-muted-foreground">{STATE_TEXT[s.state]}</span>
          </li>
        ))}
      </ol>

      <ol className="sm:hidden" aria-label={label}>
        {steps.map((s, i) => (
          <li key={s.id} className="relative flex items-center gap-3 pb-4 last:pb-0" aria-current={s.state === "current" ? "step" : undefined}>
            {i < steps.length - 1 ? (
              <span
                aria-hidden
                className={cn("absolute left-[12.5px] top-[26px] h-[calc(100%-26px)] w-px", s.state === "done" ? "bg-primary" : "bg-border")}
              />
            ) : null}
            <Node state={s.state} />
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{s.label}</span>
              <span className="text-xs text-muted-foreground">{STATE_TEXT[s.state]}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
