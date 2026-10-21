"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
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
  if (who.type === "lookup") return "Según una tabla de consulta";
  return "Se elige al enviar la solicitud";
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
          label: "Nuevo paso",
          role: "REVISOR",
          who: { type: "ask", prompt: "¿Quién revisa esta solicitud?" },
        },
      ],
    });
  };
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        <nav
          aria-label="Vista previa de la ruta de aprobación"
          className="mb-5 rounded-lg border border-border bg-muted px-4 py-3"
        >
          <p className="text-sm font-semibold">Así viajará la solicitud</p>
          <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
            <li className="rounded-full bg-foreground px-3 py-1 font-medium text-background">
              Solicitante
            </li>
            {value.steps.map((step, i) => (
              <li key={step.id} className="flex min-w-0 items-center gap-2">
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="max-w-48 truncate rounded-full border border-foreground/15 bg-background px-3 py-1 shadow-subtle">
                  {i + 1} · {step.label || "Paso sin nombre"}
                </span>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="rounded-full bg-foreground px-3 py-1 font-medium text-background">
                Fin
              </span>
            </li>
          </ol>
          <p className="mt-2 text-sm text-muted-foreground">
            Empieza cuando alguien envía su solicitud. Algunos pasos pueden
            omitirse según los datos del formato.
          </p>
        </nav>
        {value.steps.length === 0 && (
          <div className="mb-4 rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <p className="font-medium">Todavía no hay pasos</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Un paso es una persona que revisa, aprueba o firma. Empieza
              agregando el primero.
            </p>
            {!readOnly && (
              <Button className="mt-4" onClick={addStep}>
                <Plus /> Agregar el primer paso
              </Button>
            )}
          </div>
        )}
        <ol className="ml-3 border-l-2 border-foreground/15 pl-5 sm:ml-4 sm:pl-7">
          {value.steps.map((step, i) => {
            const expanded = open.has(step.id);
            const panelId = `etapa-panel-${step.id}`;
            const when = describeWhen(step.when, variables);
            const summary = [
              `${actionLabel(step.role)} — ${whoSummary(step.who)}`,
              step.when?.length ? `Solo si ${when}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={step.id} className="relative pb-3">
                <span
                  aria-hidden
                  className="absolute -left-[34px] top-4 flex size-7 items-center justify-center rounded-full bg-foreground font-mono text-xs font-semibold text-background ring-4 ring-background sm:-left-[46px]"
                >
                  {i + 1}
                </span>
                <section
                  className={cn(
                    "rounded-lg border transition-colors",
                    expanded
                      ? "border-foreground/30 bg-background shadow-elevated"
                      : "border-border bg-muted/70 hover:bg-muted",
                  )}
                  aria-label={`Paso ${i + 1}: ${step.label}`}
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
                          {step.label || "Paso sin nombre"}
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
                          aria-label={`Subir paso ${i + 1}`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={iconButton}
                          aria-label={`Bajar paso ${i + 1}`}
                          disabled={i === value.steps.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={iconButton}
                          aria-label={`Eliminar paso ${i + 1}`}
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
                        label="Nombre del paso"
                        htmlFor={`${panelId}-nombre`}
                      >
                        <Input
                          id={`${panelId}-nombre`}
                          value={step.label}
                          onChange={(e) => update(i, { label: e.target.value })}
                        />
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="¿Qué hace?" htmlFor={`${panelId}-accion`}>
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
                          label="¿Quién lo hace?"
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
                                    prompt: "¿Quién atiende este paso?",
                                  },
                                });
                              if (type === "fixed")
                                update(i, { who: { type, signerId: "" } });
                            }}
                          >
                            <option value="initiator">Quien solicita</option>
                            <option value="fixed">
                              Una persona en específico
                            </option>
                            <option value="ask">
                              Se elige al enviar la solicitud
                            </option>
                            {step.who.type === "lookup" && (
                              <option value="lookup">
                                Según una tabla de consulta
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
                            <p className="text-sm font-medium">¿Cuándo aplica?</p>
                            <p className="mt-1 break-words text-sm">{when}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Se define en «Datos y reglas (avanzado)», al
                              final de los pasos.
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
        {!readOnly && value.steps.length > 0 && (
          <Button
            variant="outline"
            className="ml-3 mt-1 sm:ml-4"
            onClick={addStep}
          >
            <Plus /> Agregar paso
          </Button>
        )}
        <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Flag className="size-4 shrink-0" aria-hidden />
          Fin: se guarda el documento con su expediente.
        </p>
        {!readOnly && (
          <details className="mt-8 border-t border-border pt-5">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Datos y reglas (avanzado)
            </summary>
            <p className="my-4 text-sm text-muted-foreground">
              Para casos especiales: qué datos se piden, consultas a tablas y
              cuándo participa cada persona. No hace falta para un proceso
              sencillo.
            </p>
            <FlowEditor value={value} onChange={onChange} />
          </details>
        )}
      </div>
      <aside className="h-fit space-y-5 rounded-lg border border-border bg-background p-4 xl:sticky xl:top-20">
        <h2 className="text-base font-semibold">Cómo se aprueba</h2>
        <Field label="¿En qué orden?" htmlFor="flujo-orden">
          <Select
            id="flujo-orden"
            disabled={readOnly}
            value={value.order}
            onChange={(e) =>
              onChange({ ...value, order: e.target.value as Flow["order"] })
            }
          >
            <option value="SECUENCIAL">Un paso a la vez</option>
            <option value="PARALELO">Todos al mismo tiempo</option>
          </Select>
        </Field>
        <Field label="Tiempo máximo para completar (en horas)" htmlFor="flujo-plazo">
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
            {problems.length ? "Falta completar" : "Todo completo"}
          </h3>
          {problems.length ? (
            <ul className="mt-2 list-disc space-y-2 pl-4 text-sm text-destructive">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {value.steps.length} {value.steps.length === 1 ? "paso" : "pasos"}.
              Al dejarlo listo también revisamos las tablas y las personas
              elegidas.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
