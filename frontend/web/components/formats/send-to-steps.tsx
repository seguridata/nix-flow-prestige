"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight, CircleDashed, Clock, UserCheck, UserPlus } from "lucide-react";

import { PersonPicker, type Person } from "@/components/formats/person-picker";
import { describeWho } from "@/libs/flow";
import { awaitingText, groupSteps, isAwaiting, needsPerson, skippedSummary } from "@/libs/format-steps";
import { cn } from "@/libs/utils";
import type { ResolvedStep } from "@/services/formats-service";

/**
 * «Se enviará a»: un resumen («20 pasos · 1ª aprobación: …») con la ruta completa plegada. Lo que pide una decisión de quien
 * llena (elegir a una persona) siempre está a la vista; el resto se revisa con «Ver ruta completa». Cada paso dice si ya está
 * asignado o se asignará al llenar, con icono y texto: el estado nunca depende solo del color.
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
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const { applicable, skipped } = groupSteps(steps);
  const total = applicable.length;
  const first = applicable[0]?.step;
  const awaiting = applicable.filter(({ step }) => isAwaiting(step)).length;
  const toChoose = applicable.filter(({ step }) => needsPerson(step) && !asked[step.stepId]).length;
  const assigned = total - awaiting - toChoose;

  const visible = expanded ? applicable : applicable.filter(({ step }) => needsPerson(step));

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">
          {total === 1 ? "1 paso" : `${total} pasos`}
          {first ? <span className="font-normal text-muted-foreground"> · 1ª aprobación: {first.label}</span> : null}
        </p>
        {total > 0 ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <UserCheck className="size-4" aria-hidden /> {assigned} {assigned === 1 ? "asignado" : "asignados"}
            </span>
            {awaiting > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-4" aria-hidden /> {awaiting} se {awaiting === 1 ? "asignará" : "asignarán"} al llenar
              </span>
            ) : null}
            {toChoose > 0 ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <UserPlus className="size-4" aria-hidden /> {toChoose} por elegir
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      {visible.length > 0 ? (
        <ol id={listId} className={cn("list-none divide-y divide-border rounded-md border border-border", expanded && "max-h-[50vh] overflow-y-auto")}>
          {visible.map(({ step: s }) => (
            // Sin número propio: cada etiqueta ya trae la numeración oficial del proceso (p. ej. «16. Notificar…»).
            <li key={s.stepId} className="px-3 py-2.5 text-sm">
              <span className="block font-medium">{s.label}</span>
              <StepWho step={s} picked={asked[s.stepId]} />
              {needsPerson(s) && (s.who.type === "ask" || s.who.type === "lookup") ? (
                <div className="mt-2">
                  <PersonPicker label={s.who.prompt} value={asked[s.stepId] ?? null} onChange={(p) => onAsk(s.stepId, p)} />
                  <p className="mt-1 text-xs text-muted-foreground">{s.who.prompt}</p>
                  {s.who.type === "lookup" ? (
                    <p className="mt-1 text-xs text-muted-foreground">No se pudo asignar a nadie con estos datos; elige a la persona.</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {total > (expanded ? 0 : visible.length) || skipped.length > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
          {expanded ? "Ocultar ruta completa" : "Ver ruta completa"}
        </button>
      ) : null}

      {expanded && skipped.length > 0 ? (
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

/** Estado de la asignación con icono y texto: asignado (con quién), se asignará al llenar, o falta elegir. */
function StepWho({ step: s, picked }: { step: ResolvedStep; picked?: Person }) {
  const line = (icon: React.ReactNode, text: React.ReactNode, muted = true) => (
    <span className={cn("mt-0.5 flex items-start gap-1.5", muted ? "text-muted-foreground" : "text-foreground")}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{text}</span>
    </span>
  );
  const person = s.who.type === "lookup" ? s.resolved : undefined;
  if (person) {
    return line(
      <UserCheck className="size-4" aria-hidden />,
      <>
        Asignado: <span className="font-medium text-foreground">{person.name || person.email || person.signerId}</span>
        {person.email && person.name ? ` · ${person.email}` : null}
      </>,
    );
  }
  if (isAwaiting(s)) return line(<Clock className="size-4" aria-hidden />, awaitingText(s));
  if (needsPerson(s)) {
    return picked
      ? line(<UserCheck className="size-4" aria-hidden />, <>Asignado: <span className="font-medium text-foreground">{picked.name || picked.email || picked.signerId}</span></>)
      : line(<UserPlus className="size-4" aria-hidden />, "Elige a la persona:", false);
  }
  return line(<UserCheck className="size-4" aria-hidden />, <>Asignado: {describeWho(s.who)}</>);
}
