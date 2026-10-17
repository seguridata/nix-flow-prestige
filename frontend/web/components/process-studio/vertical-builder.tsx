"use client";

import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { FlowEditor } from "@/components/formats/flow-editor";
import { PersonPicker } from "@/components/formats/person-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  describeWhen,
  describeWho,
  flowProblems,
  newId,
  type Flow,
  type FlowStep,
} from "@/libs/flow";

const select =
  "h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary";

export function VerticalBuilder({
  value,
  onChange,
  readOnly = false,
}: {
  value: Flow;
  onChange: (flow: Flow) => void;
  readOnly?: boolean;
}) {
  const problems = flowProblems(value);
  const update = (i: number, changes: Partial<FlowStep>) =>
    onChange({
      ...value,
      steps: value.steps.map((s, j) => (i === j ? { ...s, ...changes } : s)),
    });
  const move = (i: number, direction: number) => {
    const next = [...value.steps];
    const target = i + direction;
    if (target < 0 || target >= next.length) return;
    [next[i], next[target]] = [next[target]!, next[i]!];
    onChange({ ...value, steps: next });
  };
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div>
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-muted/60 px-5 py-4">
          <Check className="size-5" aria-hidden />
          <div>
            <h2 className="font-semibold">
              Inicio: una persona envía su solicitud
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Los datos del formato determinan la ruta de aprobación.
            </p>
          </div>
        </div>
        <ol className="ml-4 space-y-0 border-l border-border pl-6 sm:pl-8">
          {value.steps.map((step, i) => (
            <li key={step.id} className="relative pb-6">
              <span className="absolute -left-[37px] flex size-6 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold sm:-left-[45px]">
                {i + 1}
              </span>
              <section
                className="rounded-xl border border-border p-4 sm:p-5"
                aria-label={`Etapa ${i + 1}: ${step.label}`}
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    {step.role === "REVISOR" ? "Revisión" : "Firma"}
                  </span>
                  {!readOnly && (
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Subir etapa ${i + 1}`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Bajar etapa ${i + 1}`}
                        disabled={i === value.steps.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Eliminar etapa ${i + 1}`}
                        onClick={() =>
                          onChange({
                            ...value,
                            steps: value.steps.filter((_, j) => j !== i),
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
                <fieldset
                  disabled={readOnly}
                  className="space-y-4 disabled:opacity-80"
                >
                  <label className="block text-sm font-medium">
                    Nombre de la etapa
                    <Input
                      className="mt-1"
                      value={step.label}
                      onChange={(e) => update(i, { label: e.target.value })}
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm">
                      Acción
                      <select
                        className={`${select} mt-1`}
                        value={step.role}
                        onChange={(e) =>
                          update(i, {
                            role: e.target.value as FlowStep["role"],
                          })
                        }
                      >
                        <option value="REVISOR">Revisar y aprobar</option>
                        <option value="FIRMANTE">Firmar documento</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      Responsable
                      <select
                        className={`${select} mt-1`}
                        value={step.who.type}
                        onChange={(e) => {
                          const type = e.target.value;
                          if (type === "initiator")
                            update(i, { who: { type } });
                          if (type === "ask")
                            update(i, {
                              who: {
                                type,
                                prompt: "¿Quién atiende esta etapa?",
                              },
                            });
                          if (type === "fixed")
                            update(i, { who: { type, signerId: "" } });
                        }}
                      >
                        <option value="initiator">Quien solicita</option>
                        <option value="fixed">
                          Una persona del directorio
                        </option>
                        <option value="ask">
                          Elegir al crear la solicitud
                        </option>
                        {step.who.type === "lookup" && (
                          <option value="lookup">
                            Asignación por tabla de consulta
                          </option>
                        )}
                      </select>
                    </label>
                  </div>
                  {step.who.type === "fixed" && (
                    <PersonPicker
                      value={step.who.signerId ? step.who : null}
                      onChange={(person) =>
                        update(i, {
                          who: {
                            type: "fixed",
                            signerId: person?.signerId ?? "",
                            name: person?.name,
                            email: person?.email,
                          },
                        })
                      }
                    />
                  )}
                  {step.who.type === "ask" && (
                    <label className="block text-sm">
                      Pregunta para el solicitante
                      <Input
                        className="mt-1"
                        value={step.who.prompt}
                        onChange={(e) =>
                          update(i, {
                            who: { type: "ask", prompt: e.target.value },
                          })
                        }
                      />
                    </label>
                  )}
                </fieldset>
                <p className="mt-4 break-words text-sm text-muted-foreground">
                  {describeWho(step.who)} ·{" "}
                  {describeWhen(step.when, [
                    ...value.variables,
                    ...(value.derived ?? []).map((v) => ({
                      ...v,
                      required: false,
                    })),
                  ])}
                </p>
              </section>
            </li>
          ))}
        </ol>
        {!readOnly && (
          <Button
            variant="outline"
            className="ml-10"
            onClick={() =>
              onChange({
                ...value,
                steps: [
                  ...value.steps,
                  {
                    id: newId("etapa"),
                    label: "Nueva revisión",
                    role: "REVISOR",
                    who: {
                      type: "ask",
                      prompt: "¿Quién revisa esta solicitud?",
                    },
                  },
                ],
              })
            }
          >
            <Plus className="size-4" /> Agregar etapa
          </Button>
        )}
        <p className="mt-6 text-sm text-muted-foreground">
          Fin: se conserva el documento y su expediente verificable.
        </p>
        {!readOnly && (
          <details className="mt-8 border-t border-border pt-5">
            <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-primary">
              Datos, condiciones y asignación automática
            </summary>
            <p className="my-4 text-sm text-muted-foreground">
              Configura qué se pide, las consultas a tablas y cuándo participa
              cada responsable. Los cambios se reflejan en las etapas.
            </p>
            <FlowEditor value={value} onChange={onChange} />
          </details>
        )}
      </div>
      <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
        <h2 className="text-base font-semibold">Reglas de ejecución</h2>
        <label className="block text-sm">
          Orden
          <select
            disabled={readOnly}
            className={`${select} mt-2`}
            value={value.order}
            onChange={(e) =>
              onChange({ ...value, order: e.target.value as Flow["order"] })
            }
          >
            <option value="SECUENCIAL">Una etapa a la vez</option>
            <option value="PARALELO">Todas al mismo tiempo</option>
          </select>
        </label>
        <label className="block text-sm">
          Plazo total, en horas
          <Input
            disabled={readOnly}
            className="mt-2"
            type="number"
            min="1"
            value={value.slaHours}
            onChange={(e) =>
              onChange({ ...value, slaHours: Number(e.target.value) })
            }
          />
        </label>
        <div className="border-t border-border pt-4" aria-live="polite">
          <h3 className="text-sm font-medium">
            {problems.length ? "Antes de guardar" : "Estructura completa"}
          </h3>
          {problems.length ? (
            <ul className="mt-2 list-disc space-y-2 pl-4 text-sm text-destructive">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {value.steps.length} etapas · {value.variables.length} datos. Al
              publicar se comprueban también las tablas y el directorio.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
