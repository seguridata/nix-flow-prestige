"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

import { SentenceChip, SentenceRow } from "@/components/flow/sentence";
import { PersonPicker } from "@/components/formats/person-picker";
import { QueryBuilder, selectClass } from "@/components/lookup/query-builder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  allVariables,
  BUILTIN_LOOKUP_SOURCES,
  newId,
  opsFor,
  pruneDependencies,
  OP_LABEL,
  slugKey,
  VAR_TYPE_LABEL,
  type Condition,
  type DerivedVariable,
  type Flow,
  type FlowStep,
  type FlowVariable,
  type LookupWho,
  type Op,
  type VarType,
  type Who,
} from "@/libs/flow";
import { columnKeyFrom, guessPersonColumns, type LookupTableSummary } from "@/libs/lookup";
import { cn } from "@/libs/utils";
import { fetchLookupTables } from "@/services/lookup-tables-service";

const DERIVED_TYPES: VarType[] = ["text", "number", "date"];

/** Botón de icono de la fila de un paso: 44 px de lado como mínimo para tocarlo sin errar. */
const rowAction = "size-11 text-foreground";

/** Aviso en la frase: icono y texto, nunca solo color. */
function Missing({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1 align-baseline text-sm font-semibold text-foreground">
      <AlertCircle aria-hidden className="size-4 shrink-0" />
      {children}
    </span>
  );
}

/**
 * «Sus opciones dependen de otra lista»: cada valor de la otra lista muestra solo las opciones que se marcan aquí
 * (p. ej. el concepto de gasto según el tipo de gasto).
 */
function DependsOnEditor({ variable: v, all, onChange }: { variable: FlowVariable; all: FlowVariable[]; onChange: (v: FlowVariable) => void }) {
  const candidates = all.filter((x) => x.key !== v.key && x.type === "select" && !x.dependsOn && (x.options?.length ?? 0) > 0);
  const parent = v.dependsOn ? all.find((x) => x.key === v.dependsOn!.variable) : undefined;
  if (!v.dependsOn && candidates.length === 0) return null;
  const own = v.options ?? [];
  const setParent = (key: string) => {
    if (!key) {
      return onChange({ ...v, dependsOn: undefined });
    }
    onChange({ ...v, dependsOn: { variable: key, options: v.dependsOn?.variable === key ? v.dependsOn.options : {} } });
  };
  const toggle = (parentValue: string, option: string, on: boolean) => {
    const current = v.dependsOn!.options[parentValue] ?? [];
    const list = on ? own.filter((o) => current.includes(o) || o === option) : current.filter((o) => o !== option);
    onChange({ ...v, dependsOn: { ...v.dependsOn!, options: { ...v.dependsOn!.options, [parentValue]: list } } });
  };
  return (
    <div className="mt-2 space-y-2">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Sus opciones dependen de
        <select className={selectClass} aria-label="Lista de la que dependen las opciones" value={v.dependsOn?.variable ?? ""} onChange={(e) => setParent(e.target.value)}>
          <option value="">Ninguna (siempre todas)</option>
          {[...candidates, ...(parent && !candidates.includes(parent) ? [parent] : [])].map((x) => (
            <option key={x.key} value={x.key}>
              {x.label || x.key}
            </option>
          ))}
        </select>
      </label>
      {v.dependsOn && parent ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Marca qué opciones se ofrecen cuando se elige cada valor de «{parent.label || parent.key}».</p>
          {(parent.options ?? []).map((pv) => (
            <fieldset key={pv} className="rounded-md border border-border p-2">
              <legend className="px-1 text-sm font-medium">{pv}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {own.map((o) => (
                  <label key={o} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={(v.dependsOn!.options[pv] ?? []).includes(o)} onChange={(e) => toggle(pv, o, e.target.checked)} />
                    {o}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Editor del flujo de un formato o de un flujo publicable: qué datos se piden, a quién se envía y
 * en qué orden, y bajo qué condiciones se suma cada persona. Equivale a dibujar el BPMN, pero solo
 * con lo que el motor sabe ejecutar; el diagrama se genera a partir de esto. Los pasos se leen como oraciones.
 */
export function FlowEditor({ value, onChange }: { value: Flow; onChange: (f: Flow) => void }) {
  const setVars = (variables: FlowVariable[]) => onChange({ ...value, variables: pruneDependencies(variables) });
  const setSteps = (steps: FlowStep[]) => onChange({ ...value, steps });
  const derived = value.derived ?? [];
  const setDerived = (next: DerivedVariable[]) => onChange({ ...value, derived: next.length ? next : undefined });
  const everyVariable = allVariables(value);

  // Las tablas de consulta solo las ve (y las usa) el administrador que edita el flujo.
  const tablesQuery = useQuery({ queryKey: ["lookup-tables"], queryFn: fetchLookupTables, staleTime: 30_000 });
  const tables = tablesQuery.data ?? [];

  function move(from: number, to: number) {
    if (to < 0 || to >= value.steps.length) return;
    const next = [...value.steps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setSteps(next);
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="flow-vars" className="rounded-2xl bg-muted/50 p-4 sm:p-5">
        <h2 id="flow-vars" className="text-base font-semibold">
          Datos que se piden
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Quien use el formato los llena. Sirven para rellenar el documento y para decidir a quién más se envía.
        </p>

        <ul className="mt-3 space-y-2">
          {value.variables.map((v, i) => (
            <li key={v.key} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="h-10 min-w-40 flex-1"
                  aria-label="Nombre del dato"
                  placeholder="Ej. Días de vacaciones"
                  value={v.label}
                  onChange={(e) => setVars(value.variables.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <select
                  className={selectClass}
                  aria-label="Tipo de dato"
                  value={v.type}
                  onChange={(e) =>
                    setVars(value.variables.map((x, j) => (j === i ? { ...x, type: e.target.value as VarType } : x)))
                  }
                >
                  {(Object.keys(VAR_TYPE_LABEL) as VarType[]).map((t) => (
                    <option key={t} value={t}>
                      {VAR_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={v.required}
                    onCheckedChange={(c) => setVars(value.variables.map((x, j) => (j === i ? { ...x, required: c } : x)))}
                  />
                  Obligatorio
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar «${v.label || "dato"}»`}
                  onClick={() => {
                    setVars(value.variables.filter((_, j) => j !== i));
                    // Las condiciones que dependían de este dato ya no tienen sentido.
                    setSteps(value.steps.map((s) => ({ ...s, when: s.when?.filter((c) => c.variable !== v.key) })));
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
              {v.type === "select" ? (
                <Input
                  className="mt-2 h-10"
                  aria-label="Opciones separadas por coma"
                  placeholder="Opciones separadas por coma: Vacaciones, Permiso, Incapacidad"
                  value={(v.options ?? []).join(", ")}
                  onChange={(e) =>
                    setVars(
                      value.variables.map((x, j) =>
                        j === i ? { ...x, options: e.target.value.split(",").map((o) => o.trimStart()) } : x,
                      ),
                    )
                  }
                  onBlur={(e) =>
                    setVars(
                      value.variables.map((x, j) =>
                        j === i ? { ...x, options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) } : x,
                      ),
                    )
                  }
                />
              ) : null}
              {v.type === "select" ? <DependsOnEditor variable={v} all={value.variables} onChange={(nv) => setVars(value.variables.map((x, j) => (j === i ? nv : x)))} /> : null}
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() =>
            setVars([
              ...value.variables,
              { key: slugKey(`dato ${value.variables.length + 1}`, value.variables.map((x) => x.key)), label: "", type: "text", required: true },
            ])
          }
        >
          <Plus /> Agregar dato
        </Button>
      </section>

      <section aria-labelledby="flow-derived" className="rounded-2xl bg-muted/50 p-4 sm:p-5">
        <h2 id="flow-derived" className="text-base font-semibold">
          Variables calculadas desde una tabla
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Datos que el sistema calcula solo al crear la solicitud, consultando una tabla (por ejemplo, el monto límite de un área). Se pueden usar en
          las condiciones de los pasos.
        </p>
        {tablesQuery.isError ? (
          <p role="alert" className="mt-2 text-sm">
            No se pudieron cargar las tablas de consulta.{" "}
            <Button type="button" variant="link" onClick={() => void tablesQuery.refetch()}>
              Reintentar
            </Button>
          </p>
        ) : null}
        <ul className="mt-3 space-y-2.5">
          {derived.map((d, i) => (
            <DerivedCard
              key={d.key}
              index={i}
              item={d}
              inputVariables={value.variables}
              tables={tables}
              onChange={(next) => setDerived(derived.map((x, j) => (j === i ? next : x)))}
              onRemove={() => {
                setDerived(derived.filter((_, j) => j !== i));
                // Los pasos que usaban esta variable en una condición ya no pueden evaluarla.
                setSteps(value.steps.map((s) => ({ ...s, when: s.when?.filter((c) => c.variable !== d.key) })));
              }}
            />
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={tables.length === 0}
          onClick={() => {
            const key = columnKeyFrom(`calculada ${derived.length + 1}`, everyVariable.map((x) => x.key));
            setDerived([...derived, { key, label: "", type: "text", query: { table: "", match: [] }, column: "", onMiss: "empty" }]);
          }}
        >
          <Plus /> Agregar variable calculada
        </Button>
        {!tablesQuery.isLoading && !tablesQuery.isError && tables.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Aún no hay tablas de consulta. Crea una en{" "}
            <Link href={"/tablas-consulta" as never} className="underline underline-offset-2">
              Tablas de consulta
            </Link>
            .
          </p>
        ) : null}
      </section>

      <section aria-labelledby="flow-steps">
        <h2 id="flow-steps" className="text-base font-semibold">
          A quién se envía y en qué orden
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Cada oración es un paso. Toca un recuadro para cambiarlo y usa las flechas para mover el paso. Un paso con condición solo aplica cuando se cumple.
        </p>

        <ol className="mt-3 space-y-3">
          {value.steps.map((s, i) => (
            <StepSentence
              key={s.id}
              index={i}
              total={value.steps.length}
              step={s}
              variables={everyVariable}
              tables={tables}
              tablesError={tablesQuery.isError}
              onRetryTables={() => void tablesQuery.refetch()}
              onChange={(next) => setSteps(value.steps.map((x) => (x.id === s.id ? next : x)))}
              onRemove={() => setSteps(value.steps.filter((x) => x.id !== s.id))}
              onMove={(dir) => move(i, i + dir)}
              canRemove={value.steps.length > 1}
            />
          ))}
        </ol>

        <Button
          type="button"
          variant="outline"
          className="mt-3 min-h-11"
          onClick={() =>
            setSteps([...value.steps, { id: newId("paso"), label: "", who: { type: "ask", prompt: "" }, role: "FIRMANTE" }])
          }
        >
          <Plus /> Agregar otro paso
        </Button>
      </section>

      <section aria-labelledby="flow-opts" className="rounded-2xl bg-muted px-4 py-3 text-base leading-[2.25] sm:px-5 sm:text-lg">
        <h2 id="flow-opts" className="sr-only">
          Reglas del envío
        </h2>
        Cada paso se avisa
        <SentenceChip label={value.order === "PARALELO" ? "todos a la vez" : "uno tras otro"} title="Cómo firman">
          <select
            className={cn(selectClass, "w-full")}
            aria-label="Cómo firman"
            value={value.order}
            onChange={(e) => onChange({ ...value, order: e.target.value as Flow["order"] })}
          >
            <option value="SECUENCIAL">Uno tras otro, en el orden de arriba</option>
            <option value="PARALELO">Todos a la vez</option>
          </select>
        </SentenceChip>
        . En total, el proceso debe terminar en
        <SentenceChip label={String(value.slaHours)} title="Plazo para firmar (horas)">
          <Input
            type="number"
            min={1}
            max={2160}
            aria-label="Plazo para firmar (horas)"
            value={value.slaHours}
            onChange={(e) => onChange({ ...value, slaHours: Math.max(1, Math.min(2160, Number(e.target.value) || 72)) })}
          />
        </SentenceChip>
        horas.
      </section>
    </div>
  );
}

/** Texto corto de quién recibe el paso y, si falta algo por completar, el aviso que se muestra en la frase. */
function whoSummary(who: Who): { label: string; missing: string | null; labelMissing?: boolean } {
  if (who.type === "initiator") return { label: "Quien solicita", missing: null };
  if (who.type === "fixed") {
    return who.signerId.trim() ? { label: who.name || who.email || who.signerId, missing: null } : { label: "falta elegir", missing: null, labelMissing: true };
  }
  if (who.type === "ask") return { label: "Se elige al usar el formato", missing: who.prompt.trim() ? null : "falta escribir la pregunta" };
  if (!who.query.table) return { label: "Según una tabla de consulta", missing: "falta elegir la tabla" };
  const incomplete = !who.person.signerId.trim() || !who.prompt.trim();
  return { label: "Según una tabla de consulta", missing: incomplete ? "falta completar" : null };
}

function StepSentence({
  index,
  total,
  step,
  variables,
  tables,
  tablesError,
  onRetryTables,
  onChange,
  onRemove,
  onMove,
  canRemove,
}: {
  index: number;
  total: number;
  step: FlowStep;
  /** Datos del formulario y calculados: sirven en las condiciones del paso y alimentan las consultas. */
  variables: FlowVariable[];
  tables: LookupTableSummary[];
  tablesError: boolean;
  onRetryTables: () => void;
  onChange: (s: FlowStep) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canRemove: boolean;
}) {
  const n = index + 1;
  const whoType = step.who.type;

  // La pregunta de respaldo se conserva al pasar entre «se elige» y «según una tabla».
  const keptPrompt = step.who.type === "ask" || step.who.type === "lookup" ? step.who.prompt : "";
  const setWho = (type: Who["type"]) =>
    onChange({
      ...step,
      who:
        type === "initiator"
          ? { type }
          : type === "fixed"
            ? { type, signerId: "" }
            : type === "lookup"
              ? step.who.type === "lookup"
                ? step.who
                : { type, query: { table: "", match: [] }, person: { signerId: "" }, prompt: keptPrompt }
              : { type, prompt: keptPrompt },
    });

  const setCond = (i: number, c: Condition) => onChange({ ...step, when: (step.when ?? []).map((x, j) => (j === i ? c : x)) });
  const conditions = step.when ?? [];
  const who = whoSummary(step.who);

  const prefix = conditions.length ? "Solo si" : index === 0 ? "Cuando alguien envíe la solicitud," : "Después,";

  return (
    <SentenceRow
      n={n}
      actions={
        <>
          <Button type="button" variant="ghost" size="icon" className={rowAction} aria-label={`Subir el paso ${n}`} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </Button>
          <Button type="button" variant="ghost" size="icon" className={rowAction} aria-label={`Bajar el paso ${n}`} disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon" className={rowAction} aria-label={`Quitar el paso ${n}`} disabled={!canRemove} onClick={onRemove}>
            <Trash2 />
          </Button>
        </>
      }
    >
      {prefix}{" "}
      {conditions.map((c, i) => {
        const v = variables.find((x) => x.key === c.variable);
        const ops = opsFor(v?.type ?? "text");
        const valueText = String(c.value);
        return (
          <span key={i}>
            {i > 0 ? " y además " : null}
            <SentenceChip label={v ? v.label || v.key : "dato"} title={`Dato de la condición ${i + 1} del paso ${n}`}>
              <select
                className={cn(selectClass, "w-full")}
                aria-label="Dato de la condición"
                value={c.variable}
                onChange={(e) => {
                  const nv = variables.find((x) => x.key === e.target.value);
                  setCond(i, { variable: e.target.value, op: opsFor(nv?.type ?? "text")[0]!, value: "" });
                }}
              >
                {variables.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label || x.key}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 w-full justify-start"
                onClick={() => onChange({ ...step, when: conditions.filter((_, j) => j !== i) })}
              >
                <Trash2 /> Quitar condición
              </Button>
            </SentenceChip>
            <SentenceChip label={OP_LABEL[c.op]} title={`Comparación de la condición ${i + 1} del paso ${n}`}>
              <select className={cn(selectClass, "w-full")} aria-label="Operador" value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value as Op })}>
                {ops.map((o) => (
                  <option key={o} value={o}>
                    {OP_LABEL[o]}
                  </option>
                ))}
              </select>
            </SentenceChip>
            {valueText.trim() === "" ? (
              <span className="mx-0.5 inline-flex items-center gap-0.5 align-baseline">
                <AlertCircle aria-hidden className="size-4" />
              </span>
            ) : null}
            <SentenceChip label={valueText.trim() === "" ? "falta el valor" : valueText} title={`Valor de la condición ${i + 1} del paso ${n}`}>
              {v?.type === "select" ? (
                <select className={cn(selectClass, "w-full")} aria-label="Valor" value={valueText} onChange={(e) => setCond(i, { ...c, value: e.target.value })}>
                  <option value="">Elige…</option>
                  {(v.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  className="h-10"
                  aria-label="Valor"
                  type={v?.type === "number" ? "number" : v?.type === "date" ? "date" : "text"}
                  value={valueText}
                  onChange={(e) => setCond(i, { ...c, value: v?.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value })}
                />
              )}
            </SentenceChip>
          </span>
        );
      })}
      {conditions.length ? "," : null}{" "}
      {who.labelMissing ? <AlertCircle aria-hidden className="mx-0.5 inline size-4 align-baseline" /> : null}
      <SentenceChip label={who.label} title={`A quién se envía el paso ${n}`}>
        <select className={cn(selectClass, "w-full")} aria-label="A quién se envía" value={whoType} onChange={(e) => setWho(e.target.value as Who["type"])}>
          <option value="initiator">Quien solicita</option>
          <option value="fixed">Una persona fija</option>
          <option value="ask">Se elige al usar el formato</option>
          <option value="lookup">Según una tabla de consulta</option>
        </select>
        {step.who.type === "fixed" ? (
          <PersonPicker
            label={`Persona del paso ${n}`}
            value={step.who.signerId ? { signerId: step.who.signerId, name: step.who.name, email: step.who.email } : null}
            onChange={(p) => onChange({ ...step, who: { type: "fixed", signerId: p?.signerId ?? "", name: p?.name, email: p?.email } })}
          />
        ) : null}
        {step.who.type === "ask" ? (
          <Input
            className="h-10"
            aria-label="Qué se le pregunta a quien usa el formato"
            placeholder="Qué se le pregunta. Ej. ¿Quién es tu jefe directo?"
            value={step.who.prompt}
            onChange={(e) => onChange({ ...step, who: { type: "ask", prompt: e.target.value } })}
          />
        ) : null}
        {step.who.type === "lookup" ? (
          <p className="text-sm text-muted-foreground">La tabla y las columnas se configuran debajo de la oración.</p>
        ) : null}
      </SentenceChip>{" "}
      {who.missing ? <Missing>{who.missing}</Missing> : null}
      <SentenceChip label={step.role === "REVISOR" ? "revisa y aprueba" : "firma"} title={`Qué hace en el paso ${n}`}>
        <select
          className={cn(selectClass, "w-full")}
          aria-label="Qué hace en este paso"
          value={step.role}
          onChange={(e) => onChange({ ...step, role: e.target.value as FlowStep["role"] })}
        >
          <option value="FIRMANTE">Firma</option>
          <option value="REVISOR">Revisa</option>
        </select>
      </SentenceChip>{" "}
      en el paso{" "}
      {step.label.trim() ? null : <AlertCircle aria-hidden className="mx-0.5 inline size-4 align-baseline" />}
      <SentenceChip label={step.label.trim() || "falta nombre"} title={`Nombre del paso ${n}`}>
        <Input
          className="h-10"
          aria-label={`Nombre del paso ${n}`}
          placeholder="Ej. Autoriza el jefe directo"
          value={step.label}
          onChange={(e) => onChange({ ...step, label: e.target.value })}
        />
      </SentenceChip>
      .
      {step.who.type === "lookup" ? (
        <div className="mt-2 text-base">
          <LookupWhoEditor
            index={index}
            who={step.who}
            tables={tables}
            tablesError={tablesError}
            onRetryTables={onRetryTables}
            sources={[...BUILTIN_LOOKUP_SOURCES, ...variables.map((v) => ({ key: v.key, label: v.label || v.key }))]}
            onChange={(w) => onChange({ ...step, who: w })}
          />
        </div>
      ) : null}
      {variables.length > 0 ? (
        <div className="text-base leading-normal">
          <Button
            type="button"
            variant="link"
            className="min-h-11 px-0 text-sm"
            onClick={() =>
              onChange({
                ...step,
                when: [...conditions, { variable: variables[0]!.key, op: opsFor(variables[0]!.type)[0]!, value: "" }],
              })
            }
          >
            <Plus /> {conditions.length ? "Agregar otra condición" : "Solo en algunos casos"}
          </Button>
        </div>
      ) : null}
    </SentenceRow>
  );
}

function LookupWhoEditor({
  index,
  who,
  tables,
  tablesError,
  onRetryTables,
  sources,
  onChange,
}: {
  index: number;
  who: LookupWho;
  tables: LookupTableSummary[];
  tablesError: boolean;
  onRetryTables: () => void;
  sources: { key: string; label: string }[];
  onChange: (w: LookupWho) => void;
}) {
  const table = tables.find((t) => t.key === who.query.table);
  const columns = table?.columns ?? [];
  const person = who.person;
  const setPerson = (field: "signerId" | "name" | "email", v: string) =>
    onChange({ ...who, person: { ...person, [field]: field === "signerId" ? v : v || undefined } });
  const colSelect = (label: string, field: "signerId" | "name" | "email", required: boolean) => (
    <label className="block space-y-1.5">
      <span className="font-medium">
        {label} <span className="font-normal text-muted-foreground">{required ? "(obligatorio)" : "(opcional)"}</span>
      </span>
      <select
        className={cn(selectClass, "block w-full")}
        value={person[field] ?? ""}
        aria-required={required}
        aria-invalid={required && !person[field]}
        onChange={(e) => setPerson(field, e.target.value)}
      >
        <option value="">{required ? "Elige la columna…" : "Ninguna"}</option>
        {columns.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-3 text-sm leading-normal">
      {tablesError ? (
        <p role="alert">
          No se pudieron cargar las tablas de consulta.{" "}
          <Button type="button" variant="link" onClick={onRetryTables}>
            Reintentar
          </Button>
        </p>
      ) : null}
      <QueryBuilder
        name={`Paso ${index + 1}`}
        query={who.query}
        tables={tables}
        sources={sources}
        onChange={(query) => {
          const next = tables.find((t) => t.key === query.table);
          // Al cambiar de tabla se proponen las columnas de la persona; el administrador las puede corregir.
          onChange({
            ...who,
            query,
            person: query.table !== who.query.table && next ? guessPersonColumns(next.columns) : who.person,
          });
        }}
      />
      {table ? (
        <fieldset className="space-y-2.5 border-t border-border pt-3">
          <legend className="font-medium">Quién es la persona (columnas de la fila encontrada)</legend>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {colSelect("Identificador", "signerId", true)}
            {colSelect("Nombre", "name", false)}
            {colSelect("Correo", "email", false)}
          </div>
        </fieldset>
      ) : null}
      <label className="block space-y-1.5">
        <span className="font-medium">
          Pregunta si la tabla no encuentra a nadie <span className="font-normal text-muted-foreground">(obligatoria)</span>
        </span>
        <Input
          className="h-10"
          required
          aria-required="true"
          aria-invalid={!who.prompt.trim()}
          placeholder="Ej. ¿Quién autoriza este gasto?"
          value={who.prompt}
          onChange={(e) => onChange({ ...who, prompt: e.target.value })}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Si la tabla tiene a alguien para estos datos, el paso se asigna solo y no se pregunta. Quien usa el formato nunca ve la tabla.
      </p>
    </div>
  );
}

function DerivedCard({
  index,
  item,
  inputVariables,
  tables,
  onChange,
  onRemove,
}: {
  index: number;
  item: DerivedVariable;
  inputVariables: FlowVariable[];
  tables: LookupTableSummary[];
  onChange: (d: DerivedVariable) => void;
  onRemove: () => void;
}) {
  const table = tables.find((t) => t.key === item.query.table);
  const sources = [...BUILTIN_LOOKUP_SOURCES, ...inputVariables.map((v) => ({ key: v.key, label: v.label || v.key }))];
  return (
    <li className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-10 min-w-40 flex-1"
          aria-label={`Nombre de la variable calculada ${index + 1}`}
          placeholder="Ej. Monto límite del área"
          value={item.label}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
        />
        <select
          className={selectClass}
          aria-label={`Tipo de la variable calculada ${index + 1}`}
          value={item.type}
          onChange={(e) => onChange({ ...item, type: e.target.value as VarType })}
        >
          {DERIVED_TYPES.map((t) => (
            <option key={t} value={t}>
              {VAR_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <span className="font-mono text-xs text-muted-foreground">{item.key}</span>
        <Button type="button" variant="ghost" size="icon" aria-label={`Quitar «${item.label || "variable calculada"}»`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <div className="mt-2.5 space-y-2.5 rounded-md bg-muted/60 p-2.5 text-sm">
        <QueryBuilder
          name={`Variable calculada ${index + 1}`}
          query={item.query}
          tables={tables}
          sources={sources}
          onChange={(query) => onChange({ ...item, query, column: query.table !== item.query.table ? "" : item.column })}
        />
        {table ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="font-medium">Columna que se copia</span>
              <select
                className={cn(selectClass, "block w-full")}
                value={item.column}
                aria-invalid={!item.column}
                onChange={(e) => onChange({ ...item, column: e.target.value })}
              >
                <option value="">Elige la columna…</option>
                {table.columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="font-medium">Si no hay coincidencia</span>
              <select
                className={cn(selectClass, "block w-full")}
                value={item.onMiss ?? "empty"}
                onChange={(e) => onChange({ ...item, onMiss: e.target.value as "empty" | "fail" })}
              >
                <option value="empty">Dejar la variable vacía</option>
                <option value="fail">No permitir crear la solicitud</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>
    </li>
  );
}
