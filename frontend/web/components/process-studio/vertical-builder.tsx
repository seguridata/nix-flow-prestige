"use client";

import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  CircleCheck,
  Plus,
  Trash2,
} from "lucide-react";
import { FlowEditor } from "@/components/formats/flow-editor";
import { PersonPicker } from "@/components/formats/person-picker";
import {
  RoutePanel,
  SentenceChip,
  SentenceRow,
  type RouteStop,
} from "@/components/flow/sentence";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  allVariables,
  flowProblems,
  newId,
  opsFor,
  type Condition,
  type Flow,
  type FlowStep,
  type Op,
} from "@/libs/flow";

/** Operadores dichos como se leen dentro de una frase. */
const OP_SENTENCE: Record<Op, string> = {
  ">": "supera",
  ">=": "es al menos",
  "<": "es menor que",
  "<=": "es como máximo",
  "==": "es igual a",
  "!=": "es distinto de",
};

const actionVerb = (role: FlowStep["role"]) =>
  role === "REVISOR" ? "revisa y aprueba" : "firma";

const actionSub = (role: FlowStep["role"]) =>
  role === "REVISOR" ? "Revisa y aprueba" : "Firma el documento";

const iconButton = "size-11";

/** Texto + icono (no solo color) para lo que todavía no se ha elegido. */
function Missing({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-destructive">
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      {children}
    </span>
  );
}

const whoLabel = (step: FlowStep) => {
  const who = step.who;
  if (who.type === "initiator") return "Quien solicita";
  if (who.type === "fixed") {
    const name = who.name || who.email;
    return who.signerId && name ? name : <Missing>falta elegir</Missing>;
  }
  return step.label.trim() ? step.label : <Missing>falta elegir</Missing>;
};

const whoSub = (who: FlowStep["who"]) => {
  if (who.type === "initiator") return "Quien solicita";
  if (who.type === "fixed") return who.name || who.email || "Persona sin elegir";
  if (who.type === "lookup") return "Según una tabla de consulta";
  return "Se elige al enviar";
};

export function VerticalBuilder({
  value,
  onChange,
  readOnly = false,
  onTest,
}: {
  value: Flow;
  onChange: (flow: Flow) => void;
  readOnly?: boolean;
  /** Si se da, el panel de la ruta muestra «Probar antes de usar». */
  onTest?: () => void;
}) {
  const problems = flowProblems(value);
  const variables = allVariables(value);
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
  const addStep = () =>
    onChange({
      ...value,
      steps: [
        ...value.steps,
        {
          id: newId("etapa"),
          label: "Nuevo paso",
          role: "REVISOR",
          who: { type: "ask", prompt: "¿Quién revisa esta solicitud?" },
        },
      ],
    });
  const setCondition = (i: number, ci: number, c: Condition) =>
    update(i, {
      when: (value.steps[i]!.when ?? []).map((x, j) => (j === ci ? c : x)),
    });
  const addCondition = (i: number) => {
    const first = variables[0];
    if (!first) return;
    update(i, {
      when: [
        ...(value.steps[i]!.when ?? []),
        { variable: first.key, op: opsFor(first.type)[0]!, value: "" },
      ],
    });
  };
  const removeCondition = (i: number, ci: number) =>
    update(i, {
      when: (value.steps[i]!.when ?? []).filter((_, j) => j !== ci),
    });

  const stops: RouteStop[] = [
    { title: "Inicio", sub: "Alguien envía la solicitud" },
    ...value.steps.map((s, i) => ({
      title: `${i + 1} · ${s.label.trim() || "Paso sin nombre"}`,
      sub: `${actionSub(s.role)} · ${whoSub(s.who)}`,
    })),
    { title: "Fin", sub: "Se guarda el documento con su expediente" },
  ];

  const renderCondition = (
    step: FlowStep,
    i: number,
    c: Condition,
    ci: number,
  ) => {
    const v = variables.find((x) => x.key === c.variable);
    const ops = opsFor(v?.type ?? "text");
    const valueText = String(c.value);
    return (
      <span key={ci}>
        {ci > 0 ? " y además " : null}
        <SentenceChip
          title="¿Qué dato se revisa?"
          readOnly={readOnly}
          label={v?.label || c.variable}
        >
          <Select
            aria-label="Dato de la condición"
            value={c.variable}
            onChange={(e) => {
              const nv = variables.find((x) => x.key === e.target.value);
              setCondition(i, ci, {
                variable: e.target.value,
                op: opsFor(nv?.type ?? "text")[0]!,
                value: "",
              });
            }}
          >
            {variables.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label || x.key}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => removeCondition(i, ci)}
          >
            <Trash2 /> Quitar esta condición
          </Button>
        </SentenceChip>{" "}
        <SentenceChip
          title="¿Cómo se compara?"
          readOnly={readOnly}
          label={OP_SENTENCE[c.op]}
        >
          <Select
            aria-label="Comparación"
            value={c.op}
            onChange={(e) =>
              setCondition(i, ci, { ...c, op: e.target.value as Op })
            }
          >
            {ops.map((o) => (
              <option key={o} value={o}>
                {OP_SENTENCE[o]}
              </option>
            ))}
          </Select>
        </SentenceChip>{" "}
        <SentenceChip
          title="¿Con qué valor?"
          readOnly={readOnly}
          label={valueText === "" ? <Missing>falta elegir</Missing> : valueText}
        >
          {v?.type === "select" ? (
            <Select
              aria-label="Valor"
              value={valueText}
              onChange={(e) =>
                setCondition(i, ci, { ...c, value: e.target.value })
              }
            >
              <option value="">Elige…</option>
              {(v.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              aria-label="Valor"
              type={
                v?.type === "number"
                  ? "number"
                  : v?.type === "date"
                    ? "date"
                    : "text"
              }
              value={valueText}
              onChange={(e) =>
                setCondition(i, ci, {
                  ...c,
                  value:
                    v?.type === "number" && e.target.value !== ""
                      ? Number(e.target.value)
                      : e.target.value,
                })
              }
            />
          )}
        </SentenceChip>
      </span>
    );
  };

  return (
    <div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Así funciona este proceso</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Léelo como una receta.{" "}
            {readOnly
              ? "Aquí ves cada paso, en orden."
              : "Toca cualquier recuadro gris para cambiarlo."}
          </p>
          {value.steps.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-border px-4 py-8 text-center">
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
          ) : (
            <ol className="mt-5 space-y-3">
              {value.steps.map((step, i) => {
                const panelId = `etapa-panel-${step.id}`;
                const conditions = step.when ?? [];
                return (
                  <SentenceRow
                    key={step.id}
                    n={i + 1}
                    actions={
                      readOnly ? null : (
                        <>
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
                        </>
                      )
                    }
                  >
                    {conditions.length > 0 ? (
                      <>
                        Solo si{" "}
                        {conditions.map((c, ci) =>
                          renderCondition(step, i, c, ci),
                        )}
                        ,{" "}
                      </>
                    ) : i === 0 ? (
                      "Cuando alguien envíe la solicitud, "
                    ) : (
                      "Después, "
                    )}
                    <SentenceChip
                      title="¿Quién lo hace?"
                      readOnly={readOnly}
                      label={whoLabel(step)}
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
                                who: { type: "ask", prompt: e.target.value },
                              })
                            }
                          />
                        </Field>
                      )}
                      {step.who.type === "lookup" && (
                        <p className="text-sm text-muted-foreground">
                          La tabla se define en «Datos y reglas (avanzado)»,
                          debajo de los pasos.
                        </p>
                      )}
                    </SentenceChip>{" "}
                    <SentenceChip
                      title="¿Qué hace?"
                      readOnly={readOnly}
                      label={actionVerb(step.role)}
                    >
                      <Select
                        aria-label="Acción del paso"
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
                    </SentenceChip>
                    {step.role === "FIRMANTE" ? " el documento." : "."}
                    {step.who.type === "ask" && (
                      <span className="block text-sm leading-normal text-muted-foreground">
                        La persona se elige al enviar la solicitud.
                      </span>
                    )}
                    {step.who.type === "lookup" && (
                      <span className="block text-sm leading-normal text-muted-foreground">
                        La persona se asigna según una tabla de consulta.
                      </span>
                    )}
                    {!step.label.trim() && (
                      <>
                        {" "}
                        <Missing>falta elegir el nombre del paso</Missing>
                      </>
                    )}
                    {!readOnly && variables.length > 0 && (
                      <>
                        {" "}
                        <Button
                          type="button"
                          variant="ghost"
                          className="min-h-11 text-sm"
                          onClick={() => addCondition(i)}
                        >
                          <Plus />{" "}
                          {conditions.length
                            ? "Agregar otra condición"
                            : "Solo en algunos casos"}
                        </Button>
                      </>
                    )}
                  </SentenceRow>
                );
              })}
            </ol>
          )}
          {!readOnly && value.steps.length > 0 && (
            <Button
              variant="outline"
              className="mt-3 min-h-11 w-full border-dashed"
              onClick={addStep}
            >
              <Plus /> Agregar otro paso
            </Button>
          )}
          <p className="mt-4 rounded-2xl bg-muted px-4 py-3 text-base leading-[2.25]">
            Cada paso se avisa{" "}
            <SentenceChip
              title="¿En qué orden?"
              readOnly={readOnly}
              label={
                value.order === "PARALELO" ? "todos a la vez" : "uno tras otro"
              }
            >
              <Select
                aria-label="Orden de los pasos"
                value={value.order}
                onChange={(e) =>
                  onChange({ ...value, order: e.target.value as Flow["order"] })
                }
              >
                <option value="SECUENCIAL">Un paso a la vez</option>
                <option value="PARALELO">Todos al mismo tiempo</option>
              </Select>
            </SentenceChip>
            . En total, el proceso debe terminar en{" "}
            <SentenceChip
              title="Tiempo máximo para completar (en horas)"
              readOnly={readOnly}
              label={String(value.slaHours)}
            >
              <Input
                aria-label="Horas para completar"
                type="number"
                min="1"
                value={value.slaHours}
                onChange={(e) =>
                  onChange({ ...value, slaHours: Number(e.target.value) })
                }
              />
            </SentenceChip>{" "}
            horas.
          </p>
        </div>
        <RoutePanel
          className="h-fit lg:sticky lg:top-20"
          stops={stops}
          footer={
            <>
              <div aria-live="polite">
                {problems.length ? (
                  <>
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <CircleAlert aria-hidden className="size-4 shrink-0" />
                      Falta completar
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-white/80">
                      {problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <CircleCheck aria-hidden className="size-4 shrink-0" />
                    Todo completo: {value.steps.length}{" "}
                    {value.steps.length === 1 ? "paso" : "pasos"} con
                    responsable
                  </p>
                )}
              </div>
              {onTest && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
                  onClick={onTest}
                >
                  Probar antes de usar
                </Button>
              )}
            </>
          }
        />
      </div>
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
  );
}
