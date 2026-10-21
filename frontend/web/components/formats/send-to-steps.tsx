"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight, CircleDashed, Clock, UserCheck, UserPlus } from "lucide-react";

import { RoutePanel, type RouteStop } from "@/components/flow/sentence";
import { PersonPicker, type Person } from "@/components/formats/person-picker";
import { describeWho } from "@/libs/flow";
import { awaitingText, groupSteps, isAwaiting, needsPerson, skippedSummary } from "@/libs/format-steps";
import { cn } from "@/libs/utils";
import type { ResolvedStep } from "@/services/formats-service";

/**
 * «Se enviará a»: la ruta de la solicitud en un panel carbón (quien llena el formato → cada paso → fin) con un resumen
 * («20 pasos · 1ª aprobación: …») y la ruta completa plegada. Lo que pide una decisión de quien llena (elegir a una
 * persona) siempre está a la vista; el resto se revisa con «Ver ruta completa». Cada paso dice si ya está asignado, se
 * asignará al llenar o falta elegir, con texto (y icono en el resumen): el estado nunca depende solo del color.
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
  const pickers = applicable.filter(({ step }) => needsPerson(step) && (step.who.type === "ask" || step.who.type === "lookup"));

  const stops: RouteStop[] = [
    { title: "Quien llena el formato", sub: "Envía la solicitud" },
    ...visible.map(({ step: s }): RouteStop => ({ title: s.label, sub: stopSub(s, asked[s.stepId]) })),
    { title: "Fin", sub: "Todas las firmas completas" },
  ];

  return (
    <RoutePanel
      title="Ruta de la solicitud"
      stops={stops}
      className={cn(expanded && "lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto")}
    >
      <div>
        <p className="text-sm font-medium">
          {total === 1 ? "1 paso" : `${total} pasos`}
          {first ? <span className="font-normal text-white/70"> · 1ª aprobación: {first.label}</span> : null}
        </p>
        {total > 0 ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/70">
            <span className="inline-flex items-center gap-1.5">
              <UserCheck className="size-4" aria-hidden /> {assigned} {assigned === 1 ? "asignado" : "asignados"}
            </span>
            {awaiting > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-4" aria-hidden /> {awaiting} se {awaiting === 1 ? "asignará" : "asignarán"} al llenar
              </span>
            ) : null}
            {toChoose > 0 ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-white">
                <UserPlus className="size-4" aria-hidden /> {toChoose} por elegir
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div id={listId} className="space-y-4">
        {pickers.map(({ step: s }) => (
          <div key={s.stepId} className="space-y-1.5">
            <p className="flex items-start gap-1.5 text-sm font-medium">
              <UserPlus className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0">
                Elige a la persona: <span className="font-normal text-white/80">{s.label}</span>
              </span>
            </p>
            <PersonPicker label={s.who.type === "ask" || s.who.type === "lookup" ? s.who.prompt : "Persona"} value={asked[s.stepId] ?? null} onChange={(p) => onAsk(s.stepId, p)} />
            <p className="text-xs text-white/70">{s.who.type === "ask" || s.who.type === "lookup" ? s.who.prompt : null}</p>
            {s.who.type === "lookup" ? (
              <p className="text-xs text-white/70">No se pudo asignar a nadie con estos datos; elige a la persona.</p>
            ) : null}
          </div>
        ))}

        {expanded && skipped.length > 0 ? (
          <details className="group rounded-md border border-white/20">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm text-white/80 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
              {skippedSummary(skipped.length)}
            </summary>
            <ul className="space-y-2 border-t border-white/20 px-3 py-3">
              {skipped.map((s) => (
                <li key={s.stepId} className="flex items-start gap-3 text-sm text-white/70">
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

      {total > (expanded ? 0 : applicable.filter(({ step }) => needsPerson(step)).length) || skipped.length > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm text-sm font-medium text-secondary-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
          {expanded ? "Ocultar ruta completa" : "Ver ruta completa"}
        </button>
      ) : null}
    </RoutePanel>
  );
}

/** Estado de la asignación en texto: asignado (con quién), se asignará al llenar, o falta elegir. */
function stopSub(s: ResolvedStep, picked?: Person): string {
  const person = s.who.type === "lookup" ? s.resolved : undefined;
  if (person) return `Asignado: ${person.name || person.email || person.signerId}${person.email && person.name ? ` · ${person.email}` : ""}`;
  if (isAwaiting(s)) return awaitingText(s);
  if (needsPerson(s)) return picked ? `Asignado: ${picked.name || picked.email || picked.signerId}` : "Elige a la persona";
  return `Asignado: ${describeWho(s.who)}`;
}
