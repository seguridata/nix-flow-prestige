"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleCheck,
  Flag,
  Plus,
  Trash2,
} from "lucide-react";
import { FlowEditor } from "@/components/formats/flow-editor";
import { PersonPicker } from "@/components/formats/person-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  describeWhen,
  flowProblems,
  newId,
  type Flow,
  type FlowStep,
} from "@/libs/flow";
import { cn } from "@/libs/utils";

const actionLabel = (role: FlowStep["role"]) =>
  role === "REVISOR" ? "Revisar y aprobar" : "Firmar documento";

const whoSummary = (who: FlowStep["who"]) => {
  if (who.type === "initiator") return "Quien solicita";
  if (who.type === "fixed") return who.name || who.email || "Persona sin elegir";
  if (who.type === "lookup") return "Asignación por tabla de consulta";
  return "Se elige al crear la solicitud";
};

const iconButton = "size-11 sm:size-10";

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
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const variables = [
    ...value.variables,
    ...(value.derived ?? []).map((v) => ({ ...v, required: false })),
  ];
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
  const addStep = () => {
    const id = newId("etapa");
    setOpen((current) => new Set(current).add(id));
    onChange({
      ...value,
      steps: [
        ...value.steps,
        {
          id,
          label: "Nueva revisión",
          role: "REVISOR",
          who: { type: "ask", prompt: "¿Quién revisa esta solicitud?" },
        },
      ],
    });
  };
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        <div className="mb-4 flex items-start gap-3 rounded-lg bg-muted/60 px-4 py-3">
          <CircleCheck
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div>
            <h2 className="text-sm font-semibold">
              Inicio: una persona envía su solicitud
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Los datos del formato determinan la ruta de aprobación.
            </p>
          </div>
        </div>
        <ol className="ml-3 border-l border-border pl-5 sm:ml-4 sm:pl-7">
          {value.steps.map((step, i) => {
            const expanded = open.has(step.id);
            const panelId = `etapa-panel-${step.id}`;
            const when = describeWhen(step.when, variables);
            const summary = [
              actionLabel(step.role),
              whoSummary(step.who),
              step.when?.length ? `Solo si ${when}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={step.id} className="relative pb-3">
                <span
                  aria-hidden
                  className="absolute -left-[33px] top-4 flex size-6 items-center justify-center rounded-full border border-border bg-background font-mono text-xs font-semibold sm:-left-[45px]"
                >
                  {i + 1}
                </span>
                <section
                  className="rounded-lg border border-border bg-background"
                  aria-label={`Etapa ${i + 1}: ${step.label}`}
                >
                  <div className="flex items-center gap-1 pr-1">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      onClick={() => toggle(step.id)}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {step.label || "Etapa sin nombre"}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {summary}
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          expanded && "rotate-180",
                        )}
                      />
                    </button>
                    {!readOnly && (
                      <div className="flex shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className={iconButton}
                          aria-label={`Subir etapa ${i + 1}`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={iconButton}
                          aria-label={`Bajar etapa ${i + 1}`}
                          disabled={i === value.steps.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={iconButton}
                          aria-label={`Eliminar etapa ${i + 1}`}
                          onClick={() =>
                            onChange({
                              ...value,
                              steps: value.steps.filter((_, j) => j !== i),
                            })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </div>
                  {expanded && (
                    <fieldset
                      id={panelId}
                      disabled={readOnly}
                      className="space-y-4 border-t border-border p-4 disabled:opacity-80"
                    >
                      <Field
                        label="Nombre de la etapa"
                        htmlFor={`${panelId}-nombre`}
                      >
                        <Input
                          id={`${panelId}-nombre`}
                          value={step.label}
                          onChange={(e) => update(i, { label: e.target.value })}
                        />
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Acción" htmlFor={`${panelId}-accion`}>
                          <Select
                            id={`${panelId}-accion`}
                            value={step.role}
                            onChange={(e) =>
                              update(i, {
                                role: e.target.value as FlowStep["role"],
                              })
                            }
                          >
                            <option value="REVISOR">Revisar y aprobar</option>
                            <option value="FIRMANTE">Firmar documento</option>
                          </Select>
                        </Field>
                        <Field
                          label="Responsable"
                          htmlFor={`${panelId}-responsable`}
                        >
                          <Select
                            id={`${panelId}-responsable`}
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
                          </Select>
                        </Field>
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
                      <details className="group rounded-md border border-border">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                          Más opciones
                          <ChevronDown
                            aria-hidden
                            className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                          />
                        </summary>
                        <div className="space-y-4 border-t border-border p-3">
                          {step.who.type === "ask" && (
                            <Field
                              label="Pregunta para el solicitante"
                              htmlFor={`${panelId}-pregunta`}
                              hint="Es lo que verá quien crea la solicitud al elegir responsable."
                            >
                              <Input
                                id={`${panelId}-pregunta`}
                                value={step.who.prompt}
                                onChange={(e) =>
                                  update(i, {
                                    who: {
                                      type: "ask",
                                      prompt: e.target.value,
                                    },
                                  })
                                }
                              />
                            </Field>
                          )}
                          <div>
                            <p className="text-sm font-medium">Condición</p>
                            <p className="mt-1 break-words text-sm">{when}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Se edita en «Datos, condiciones y asignación
                              automática», al final de las etapas.
                            </p>
                          </div>
                        </div>
                      </details>
                    </fieldset>
                  )}
                </section>
              </li>
            );
          })}
        </ol>
        {!readOnly && (
          <Button
            variant="outline"
            className="ml-3 mt-1 sm:ml-4"
            onClick={addStep}
          >
            <Plus /> Agregar etapa
          </Button>
        )}
        <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Flag className="size-4 shrink-0" aria-hidden />
          Fin: se conserva el documento y su expediente verificable.
        </p>
        {!readOnly && (
          <details className="mt-8 border-t border-border pt-5">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
      <aside className="h-fit space-y-5 rounded-lg border border-border bg-background p-4 xl:sticky xl:top-20">
        <h2 className="text-base font-semibold">Reglas de ejecución</h2>
        <Field label="Orden" htmlFor="flujo-orden">
          <Select
            id="flujo-orden"
            disabled={readOnly}
            value={value.order}
            onChange={(e) =>
              onChange({ ...value, order: e.target.value as Flow["order"] })
            }
          >
            <option value="SECUENCIAL">Una etapa a la vez</option>
            <option value="PARALELO">Todas al mismo tiempo</option>
          </Select>
        </Field>
        <Field label="Plazo total, en horas" htmlFor="flujo-plazo">
          <Input
            id="flujo-plazo"
            disabled={readOnly}
            type="number"
            min="1"
            value={value.slaHours}
            onChange={(e) =>
              onChange({ ...value, slaHours: Number(e.target.value) })
            }
          />
        </Field>
        <div className="border-t border-border pt-4" aria-live="polite">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <CircleCheck
              aria-hidden
              className={cn(
                "size-4",
                problems.length ? "text-destructive" : "text-muted-foreground",
              )}
            />
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
