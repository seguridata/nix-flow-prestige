"use client";

import { Check, ChevronRight, CircleDashed, Clock, ShieldCheck } from "lucide-react";

import { PersonPicker, type Person } from "@/components/formats/person-picker";
import { describeWho } from "@/libs/flow";
import { awaitingText, groupSteps, isAwaiting, needsPerson, skippedSummary } from "@/libs/format-steps";
import type { ResolvedStep } from "@/services/formats-service";

/**
 * «Se enviará a»: los pasos que aplican primero, en su orden y numerados; los que no aplican con estos datos, juntos en un
 * bloque plegable (cerrado por defecto) para que no tapen lo importante. El estado nunca depende solo del color: cada
 * paso lleva icono y texto.
 */
export function SendToSteps({
  steps,
  asked,
  onAsk,
}: {
  steps: readonly ResolvedStep[];
  asked: Record<string, Person>;
  onAsk: (stepId: string, person: Person | null) => void;
}) {
  const { applicable, skipped } = groupSteps(steps);
  return (
    <div className="mt-3 space-y-3">
      <ol className="list-none space-y-3">
        {applicable.map(({ step: s }) => (
          // Sin número de orden propio: cada etiqueta ya trae la numeración oficial del proceso (p. ej. «16. Notificar…»)
          // y una segunda numeración confundía. El orden lo sigue transmitiendo la lista ordenada a los lectores de pantalla.
          <li key={s.stepId} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 shrink-0">{isAwaiting(s) ? <Clock className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{s.label}</span>
              <StepWho step={s} />
              {needsPerson(s) && (s.who.type === "ask" || s.who.type === "lookup") ? (
                <div className="mt-1.5">
                  <PersonPicker label={s.who.prompt} value={asked[s.stepId] ?? null} onChange={(p) => onAsk(s.stepId, p)} />
                  <p className="mt-1 text-xs text-muted-foreground">{s.who.prompt}</p>
                  {s.who.type === "lookup" ? (
                    <p className="mt-1 text-xs text-muted-foreground">No se pudo asignar a nadie con estos datos; elige a la persona.</p>
                  ) : null}
                </div>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      {skipped.length > 0 ? (
        <details className="group rounded-md border border-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
            {skippedSummary(skipped.length)}
          </summary>
          <ul className="space-y-2 border-t border-border px-3 py-3">
            {skipped.map((s) => (
              <li key={s.stepId} className="flex items-start gap-3 text-sm text-muted-foreground">
                <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium line-through">{s.label}</span>
                  <span className="block">No aplica con estos datos</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Quién participa: la persona que resolvió el sistema, lo que falta para asignarla, o la descripción del paso. */
function StepWho({ step: s }: { step: ResolvedStep }) {
  const person = s.who.type === "lookup" ? s.resolved : undefined;
  if (person) {
    return (
      <span className="block">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">{person.name || person.email || person.signerId}</span>
            {person.email && person.name ? <span className="text-muted-foreground"> · {person.email}</span> : null}
          </span>
        </span>
      </span>
    );
  }
  if (isAwaiting(s)) return <span className="block text-muted-foreground">{awaitingText(s)}</span>;
  if (needsPerson(s)) return <span className="block">Elige a la persona:</span>;
  return <span className="block">{describeWho(s.who)}</span>;
}
