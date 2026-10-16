"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

import { PersonPicker } from "@/components/formats/person-picker";
import { QueryBuilder, selectClass } from "@/components/lookup/query-builder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  allVariables,
  newId,
  opsFor,
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

/**
 * Editor del flujo de un formato o de un flujo publicable: qué datos se piden, a quién se envía y
 * en qué orden, y bajo qué condiciones se suma cada persona. Equivale a dibujar el BPMN, pero solo
 * con lo que el motor sabe ejecutar; el diagrama se genera a partir de esto.
 */
export function FlowEditor({ value, onChange }: { value: Flow; onChange: (f: Flow) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const setVars = (variables: FlowVariable[]) => onChange({ ...value, variables });
  const setSteps = (steps: FlowStep[]) => onChange({ ...value, steps });
  const derived = value.derived ?? [];
  const setDerived = (next: DerivedVariable[]) => onChange({ ...value, derived: next.length ? next : undefined });
  const everyVariable = allVariables(value);

  // Las tablas de consulta solo las ve (y las usa) el administrador que edita el flujo.
  const tablesQuery = useQuery({ queryKey: ["lookup-tables"], queryFn: fetchLookupTables, staleTime: 30_000 });
  const tables = tablesQuery.data ?? [];

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = value.steps.findIndex((s) => s.id === e.active.id);
    const to = value.steps.findIndex((s) => s.id === e.over!.id);
    if (from >= 0 && to >= 0) setSteps(arrayMove(value.steps, from, to));
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="flow-vars">
        <h2 id="flow-vars" className="text-base font-semibold">
          Datos que se piden
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Quien use el formato los llena. Sirven para rellenar el documento y para decidir a quién más se envía.
        </p>

        <ul className="mt-3 space-y-2">
          {value.variables.map((v, i) => (
            <li key={v.key} className="rounded-lg border border-border p-3">
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

      <section aria-labelledby="flow-derived">
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
          Arrastra para cambiar el orden. Un paso con condición solo aplica cuando se cumple.
        </p>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={value.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ol className="mt-3 space-y-2.5">
              {value.steps.map((s, i) => (
                <StepCard
                  key={s.id}
                  index={i}
                  step={s}
                  variables={everyVariable}
                  inputVariables={value.variables}
                  tables={tables}
                  tablesError={tablesQuery.isError}
                  onRetryTables={() => void tablesQuery.refetch()}
                  onChange={(next) => setSteps(value.steps.map((x) => (x.id === s.id ? next : x)))}
                  onRemove={() => setSteps(value.steps.filter((x) => x.id !== s.id))}
                  canRemove={value.steps.length > 1}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2.5"
          onClick={() =>
            setSteps([...value.steps, { id: newId("paso"), label: "", who: { type: "ask", prompt: "" }, role: "FIRMANTE" }])
          }
        >
          <Plus /> Agregar paso
        </Button>
      </section>

      <section aria-labelledby="flow-opts" className="grid gap-4 sm:grid-cols-2">
        <h2 id="flow-opts" className="sr-only">
          Reglas del envío
        </h2>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Cómo firman</span>
          <select
            className={cn(selectClass, "w-full")}
            value={value.order}
            onChange={(e) => onChange({ ...value, order: e.target.value as Flow["order"] })}
          >
            <option value="SECUENCIAL">Uno tras otro, en el orden de arriba</option>
            <option value="PARALELO">Todos a la vez</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Plazo para firmar (horas)</span>
          <Input
            type="number"
            min={1}
            max={2160}
            value={value.slaHours}
            onChange={(e) => onChange({ ...value, slaHours: Math.max(1, Math.min(2160, Number(e.target.value) || 72)) })}
          />
        </label>
      </section>
    </div>
  );
}

function StepCard({
  index,
  step,
  variables,
  inputVariables,
  tables,
  tablesError,
  onRetryTables,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  step: FlowStep;
  /** Datos del formulario y calculados: sirven en las condiciones del paso. */
  variables: FlowVariable[];
  /** Solo los datos del formulario: son los que alimentan una consulta. */
  inputVariables: FlowVariable[];
  tables: LookupTableSummary[];
  tablesError: boolean;
  onRetryTables: () => void;
  onChange: (s: FlowStep) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
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

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-lg border border-border bg-background p-3", isDragging && "relative z-10 shadow-lg")}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={`Mover el paso ${index + 1}`}
          className="mt-2 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <span className="mt-2.5 w-14 shrink-0 text-sm font-medium text-muted-foreground">Paso {index + 1}</span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap gap-2">
            <Input
              className="h-10 min-w-40 flex-1"
              aria-label={`Nombre del paso ${index + 1}`}
              placeholder="Ej. Autoriza el jefe directo"
              value={step.label}
              onChange={(e) => onChange({ ...step, label: e.target.value })}
            />
            <select
              className={selectClass}
              aria-label="Qué hace en este paso"
              value={step.role}
              onChange={(e) => onChange({ ...step, role: e.target.value as FlowStep["role"] })}
            >
              <option value="FIRMANTE">Firma</option>
              <option value="REVISOR">Revisa</option>
            </select>
            <select className={selectClass} aria-label="A quién se envía" value={whoType} onChange={(e) => setWho(e.target.value as Who["type"])}>
              <option value="initiator">Quien solicita</option>
              <option value="fixed">Una persona fija</option>
              <option value="ask">Se elige al usar el formato</option>
              <option value="lookup">Según una tabla de consulta</option>
            </select>
          </div>

          {step.who.type === "fixed" ? (
            <PersonPicker
              label={`Persona del paso ${index + 1}`}
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
            <LookupWhoEditor
              index={index}
              who={step.who}
              tables={tables}
              tablesError={tablesError}
              onRetryTables={onRetryTables}
              sources={inputVariables.map((v) => ({ key: v.key, label: v.label || v.key }))}
              onChange={(who) => onChange({ ...step, who })}
            />
          ) : null}

          {(step.when ?? []).map((c, i) => {
            const v = variables.find((x) => x.key === c.variable);
            const ops = opsFor(v?.type ?? "text");
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 p-2 text-sm">
                <span className="font-medium">{i === 0 ? "Solo si" : "y además"}</span>
                <select
                  className={selectClass}
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
                <select className={selectClass} aria-label="Operador" value={c.op} onChange={(e) => setCond(i, { ...c, op: e.target.value as Op })}>
                  {ops.map((o) => (
                    <option key={o} value={o}>
                      {OP_LABEL[o]}
                    </option>
                  ))}
                </select>
                {v?.type === "select" ? (
                  <select className={selectClass} aria-label="Valor" value={String(c.value)} onChange={(e) => setCond(i, { ...c, value: e.target.value })}>
                    <option value="">Elige…</option>
                    {(v.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className="h-10 w-36"
                    aria-label="Valor"
                    type={v?.type === "number" ? "number" : v?.type === "date" ? "date" : "text"}
                    value={String(c.value)}
                    onChange={(e) => setCond(i, { ...c, value: v?.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value })}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Quitar condición"
                  onClick={() => onChange({ ...step, when: (step.when ?? []).filter((_, j) => j !== i) })}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}

          {variables.length > 0 ? (
            <Button
              type="button"
              variant="link"
              className="text-sm"
              onClick={() =>
                onChange({
                  ...step,
                  when: [...(step.when ?? []), { variable: variables[0]!.key, op: opsFor(variables[0]!.type)[0]!, value: "" }],
                })
              }
            >
              <Plus /> {step.when?.length ? "Agregar otra condición" : "Solo en algunos casos"}
            </Button>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={`Quitar el paso ${index + 1}`} disabled={!canRemove} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
    </li>
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
    <div className="space-y-3 rounded-md bg-muted/60 p-2.5 text-sm">
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
  const sources = inputVariables.map((v) => ({ key: v.key, label: v.label || v.key }));
  return (
    <li className="rounded-lg border border-border p-3">
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
