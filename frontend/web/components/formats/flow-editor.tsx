"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";

import { PersonPicker } from "@/components/formats/person-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  newId,
  opsFor,
  OP_LABEL,
  slugKey,
  VAR_TYPE_LABEL,
  type Condition,
  type Flow,
  type FlowStep,
  type FlowVariable,
  type Op,
  type VarType,
  type Who,
} from "@/libs/flow";
import { cn } from "@/libs/utils";

const selectClass =
  "h-10 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40";

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
                  variables={value.variables}
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
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  step: FlowStep;
  variables: FlowVariable[];
  onChange: (s: FlowStep) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const whoType = step.who.type;

  const setWho = (type: Who["type"]) =>
    onChange({
      ...step,
      who: type === "initiator" ? { type } : type === "fixed" ? { type, signerId: "" } : { type, prompt: step.who.type === "ask" ? step.who.prompt : "" },
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
