"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/libs/utils";

export interface KanbanTask {
  id: string;
  name: string;
  status: string;
  dueDate?: string | null;
  signatureRequestId?: string;
}

const COLUMNS = [
  { id: "CREADA", label: "Nueva" },
  { id: "ASIGNADA", label: "En curso" },
  { id: "COMPLETADA", label: "Hecha" },
  { id: "EXPIRADA", label: "Expirada" },
];

function CardItem({ task }: { task: KanbanTask }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-md border border-border bg-card p-3 shadow-subtle", isDragging && "opacity-70")}
      {...attributes}
      {...listeners}
    >
      <p className="text-sm font-medium">{task.name}</p>
      {task.dueDate ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          vence {new Date(task.dueDate).toLocaleString("es-MX")}
        </p>
      ) : null}
    </div>
  );
}

function Column({
  id,
  label,
  tasks,
}: {
  id: string;
  label: string;
  tasks: KanbanTask[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn("flex min-h-[280px] flex-col rounded-lg bg-muted/50 p-3", isOver && "ring-1 ring-primary/40")}
    >
      <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label} · {tasks.length}
      </p>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2">
          {tasks.map((task) => (
            <CardItem key={task.id} task={task} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

export function TaskKanban({
  tasks,
  onMove,
}: {
  tasks: KanbanTask[];
  onMove: (taskId: string, status: string) => void;
}) {
  const [local, setLocal] = useState(tasks);
  useEffect(() => {
    setLocal(tasks);
  }, [tasks]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const grouped = useMemo(() => {
    const source = local.length === tasks.length ? local : tasks;
    return COLUMNS.map((col) => ({
      ...col,
      tasks: source.filter((t) => (col.id === "CREADA" ? t.status === "CREADA" : t.status === col.id)),
    }));
  }, [local, tasks]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const overId = String(over.id);
    const column = COLUMNS.find((c) => c.id === overId);
    const targetStatus = column?.id ?? tasks.find((t) => t.id === overId)?.status;
    if (!targetStatus) return;
    const taskId = String(active.id);
    setLocal((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: targetStatus } : t)));
    onMove(taskId, targetStatus);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {grouped.map((col) => (
          <Column key={col.id} id={col.id} label={col.label} tasks={col.tasks} />
        ))}
      </div>
    </DndContext>
  );
}

export { COLUMNS };
