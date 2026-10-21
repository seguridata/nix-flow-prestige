"use client";

import { AlertCircle, Check } from "lucide-react";

import { RoutePanel, type RouteStop } from "@/components/flow/sentence";
import { allVariables, describeWhen, describeWho, type Flow } from "@/libs/flow";

/**
 * Ruta calculada del flujo (Inicio → pasos → Fin) en un `RoutePanel`, con «Todo completo» o los pendientes al pie.
 * Se usa junto al editor, en el paso «Datos y firmantes» del asistente de formatos.
 */
export function FlowRoutePanel({ flow, problems, className }: { flow: Flow; problems: string[]; className?: string }) {
  const every = allVariables(flow);
  const stops: RouteStop[] = [
    { title: "Inicio", sub: "Alguien envía la solicitud" },
    ...flow.steps.map((s, i): RouteStop => {
      const action = s.role === "REVISOR" ? "Revisa y aprueba" : "Firma";
      const cond = s.when?.length ? ` · Solo si ${describeWhen(s.when, every)}` : "";
      return { title: s.label.trim() || `Paso ${i + 1} sin nombre`, sub: `${action}: ${describeWho(s.who)}${cond}` };
    }),
    { title: "Fin", sub: `Plazo total: ${flow.slaHours} horas` },
  ];
  const shown = problems.slice(0, 4);
  return (
    <RoutePanel
      title="Así viajará la solicitud"
      stops={stops}
      className={className}
      footer={
        problems.length === 0 ? (
          <p role="status" className="flex items-center gap-2 text-sm font-semibold">
            <Check aria-hidden className="size-4 shrink-0" /> Todo completo
          </p>
        ) : (
          <div role="status" className="space-y-2 text-sm">
            <p className="font-semibold">{problems.length === 1 ? "Falta 1 cosa en este paso" : `Faltan ${problems.length} cosas en este paso`}</p>
            <ul className="space-y-1.5">
              {shown.map((p, i) => (
                <li key={`${i}-${p}`} className="flex items-start gap-2 text-white/80">
                  <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">{p}</span>
                </li>
              ))}
            </ul>
            {problems.length > shown.length ? <p className="text-white/70">y {problems.length - shown.length} más</p> : null}
          </div>
        )
      }
    />
  );
}
