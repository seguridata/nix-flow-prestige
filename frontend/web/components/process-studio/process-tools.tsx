"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/services/api-client";
import type { Flow } from "@/libs/flow";

interface Preview {
  steps: {
    id: string;
    label: string;
    role: string;
    active: boolean;
    participant: { signerId: string; name?: string; email?: string } | null;
    awaiting: { key: string; label: string }[];
    needsSelection: boolean;
  }[];
  lookups: { stepId: string; table: string; revision: number; rowId: string }[];
  derived: Record<string, unknown>;
  order: string;
  slaHours: number;
}

export function ProcessLab({
  processKey,
  flow,
}: {
  processKey: string;
  flow: Flow;
}) {
  const [values, setValues] = useState<Record<string, string | number | null>>(
    {},
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const preview = useMutation({
    mutationFn: async () => {
      setPreviewError(null);
      try {
        return await apiClient.post<Preview>(
          `/process-definitions/${encodeURIComponent(processKey)}/preview-flow`,
          { values, flow },
        );
      } catch (error) {
        setPreviewError(
          error instanceof Error ? error.message : "No se pudo evaluar la ruta.",
        );
        return null;
      }
    },
  });
  const set = (key: string, value: string | number | null) => {
    setValues((p) => ({ ...p, [key]: value }));
    preview.reset();
  };
  return (
    <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          preview.mutate();
        }}
      >
        <h2 className="text-lg font-semibold">Comprueba una ruta real</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Introduce datos y consulta el mismo motor que resuelve las
          solicitudes. No se envía ningún documento ni se crea una solicitud.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          La asignación por solicitante usa tu identidad autenticada.
        </p>
        <div className="mt-6 space-y-4">
          {flow.variables.map((v) => (
            <label key={v.key} className="block text-sm font-medium">
              {v.label}
              {v.required && (
                <span className="ml-1 text-muted-foreground">
                  (obligatorio)
                </span>
              )}
              {v.type === "select" ? (
                <select
                  className="mt-2 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
                  value={String(values[v.key] ?? "")}
                  onChange={(e) => set(v.key, e.target.value || null)}
                >
                  <option value="">Sin valor</option>
                  {v.options?.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <Input
                  className="mt-2"
                  type={
                    v.type === "number"
                      ? "number"
                      : v.type === "date"
                        ? "date"
                        : "text"
                  }
                  value={values[v.key] ?? ""}
                  onChange={(e) =>
                    set(
                      v.key,
                      e.target.value === ""
                        ? null
                        : v.type === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                    )
                  }
                />
              )}
            </label>
          ))}
        </div>
        <Button className="mt-6" type="submit" disabled={preview.isPending}>
          <FlaskConical />
          {preview.isPending ? "Resolviendo…" : "Evaluar recorrido"}
        </Button>
        {previewError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {previewError}
          </p>
        )}
      </form>
      <section
        className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"
        aria-live="polite"
      >
        {!preview.data ? (
          <div className="py-8">
            <FlaskConical
              className="size-7 text-muted-foreground"
              aria-hidden
            />
            <h3 className="mt-4 font-semibold">
              Ve quién participa antes de publicar
            </h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              El resultado mostrará las etapas aplicables, las personas
              resueltas, los datos faltantes y las tablas consultadas.
            </p>
          </div>
        ) : (
          <>
            <h3 className="text-lg font-semibold">Ruta resultante</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {preview.data.order === "PARALELO"
                ? "Etapas en paralelo"
                : "Una etapa a la vez"}{" "}
              · plazo {preview.data.slaHours} h
            </p>
            <ol className="mt-6 ml-3 border-l border-border pl-6">
              {preview.data.steps.map((step) => (
                <li key={step.id} className="relative pb-7">
                  <span className="absolute -left-[33px] bg-background">
                    {step.active ? (
                      <CheckCircle2 className="size-4" aria-hidden />
                    ) : (
                      <CircleDashed
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </span>
                  <h4 className="font-medium">{step.label}</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {!step.active
                      ? "No aplica con estos datos"
                      : step.participant
                        ? step.participant.name ||
                          step.participant.email ||
                          step.participant.signerId
                        : step.awaiting?.length
                          ? `Falta completar: ${step.awaiting.map((v) => v.label).join(", ")}`
                          : step.needsSelection
                            ? "Se elige a la persona al crear la solicitud"
                            : "Sin responsable resuelto"}
                  </p>
                  {step.active && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {step.role === "REVISOR"
                        ? "Revisión y aprobación"
                        : "Firma de documento"}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            {!!preview.data.lookups?.length && (
              <details className="border-t border-border pt-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Trazabilidad de las consultas
                </summary>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {preview.data.lookups.map((l, i) => (
                    <li key={`${l.stepId}-${i}`}>
                      {l.table} · revisión {l.revision} · fila {l.rowId}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {preview.data.derived &&
              Object.keys(preview.data.derived).length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Valores calculados
                  </summary>
                  <dl className="mt-3 space-y-2 text-sm">
                    {Object.entries(preview.data.derived).map(
                      ([key, value]) => (
                        <div key={key} className="flex flex-wrap gap-2">
                          <dt className="font-medium">{key}</dt>
                          <dd>
                            {typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value ?? "Sin valor")}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                </details>
              )}
          </>
        )}
      </section>
    </div>
  );
}

interface Impact {
  workflows: {
    total: number;
    active: number;
    byStatus: { status: string; count: number }[];
  };
  templates: { total: number; byVersion: { version: number; count: number }[] };
  versionAttribution: string;
}
export function ImpactPanel({ processKey }: { processKey: string }) {
  const [open, setOpen] = useState(false);
  const impact = useQuery({
    queryKey: ["process-impact", processKey],
    queryFn: () =>
      apiClient.get<Impact>(
        `/process-definitions/${encodeURIComponent(processKey)}/impact`,
      ),
    enabled: open,
  });
  return (
    <details
      className="mt-8 border-t border-border pt-5"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-primary">
        Antes de cambiar: dónde se usa este proceso
      </summary>
      {impact.isPending ? (
        <p role="status" className="mt-4 text-sm">
          Consultando dependencias…
        </p>
      ) : impact.isError ? (
        <p role="alert" className="mt-4 text-sm">
          No se pudo consultar el impacto.{" "}
          <button className="underline" onClick={() => impact.refetch()}>
            Reintentar
          </button>
        </p>
      ) : (
        impact.data && (
          <div className="mt-4 grid gap-5 text-sm sm:grid-cols-2">
            <div>
              <h3 className="font-medium">Solicitudes</h3>
              <p className="mt-1 text-muted-foreground">
                {impact.data.workflows.total} registradas ·{" "}
                {impact.data.workflows.active} en curso
              </p>
              <ul className="mt-3 space-y-1">
                {impact.data.workflows.byStatus.map((s) => (
                  <li key={s.status} className="flex gap-3">
                    <span>{s.status.replaceAll("_", " ")}</span>
                    <ArrowRight
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
              {impact.data.versionAttribution === "not-recorded" && (
                <p className="mt-3 max-w-sm text-xs text-muted-foreground">
                  Los registros históricos no identifican la versión del proceso
                  ejecutada. Estos conteos corresponden al proceso completo.
                </p>
              )}
            </div>
            <div>
              <h3 className="font-medium">Formatos vinculados</h3>
              <p className="mt-1 text-muted-foreground">
                {impact.data.templates.total} formatos usan este flujo.
              </p>
              <ul className="mt-3 space-y-1">
                {impact.data.templates.byVersion.map((v) => (
                  <li key={v.version}>
                    v{v.version}: {v.count}{" "}
                    {v.count === 1 ? "formato" : "formatos"}
                  </li>
                ))}
              </ul>
              <p className="mt-3 max-w-sm text-xs text-muted-foreground">
                Cada formato conserva la versión elegida. Publicar otra versión
                no cambia automáticamente sus solicitudes existentes.
              </p>
            </div>
          </div>
        )
      )}
    </details>
  );
}
