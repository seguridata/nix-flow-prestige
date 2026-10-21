"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleAlert, CircleCheck, CircleX, Clock, LayoutGrid, ListChecks, List, TimerOff, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { DueLabel } from "@/components/inbox/due-label";
import { TaskKanban } from "@/components/bpm/task-kanban";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/libs/utils";
import { apiClient } from "@/services/api-client";
import { clearOutOfOffice, fetchOutOfOffice, setOutOfOffice } from "@/services/availability-service";
import { buildDelegatePayload } from "@/services/payloads";
import { delegateRequest } from "@/services/signature-requests-service";
import { useSession } from "@/store/session-store";

interface Task {
  id: string;
  name: string;
  status: string;
  priority?: number;
  signerId: string;
  signatureRequestId: string;
  dueDate: string | null;
  claimedBy?: string | null;
  remindersSent?: number;
  escalatedAt?: string | null;
  delegatedFrom?: string | null;
}

type BadgeTone = "success" | "warning" | "pending" | "destructive" | "neutral";

/** Estado de la tarea con icono y texto, y la acción que sigue (si la hay). */
const STATUS: Record<string, { label: string; tone: BadgeTone; icon: LucideIcon; next?: { to: string; cta: string } }> = {
  CREADA: { label: "Nueva", tone: "warning", icon: CircleAlert, next: { to: "ASIGNADA", cta: "Tomar tarea" } },
  ASIGNADA: { label: "En curso", tone: "pending", icon: Clock, next: { to: "COMPLETADA", cta: "Marcar como hecha" } },
  COMPLETADA: { label: "Hecha", tone: "success", icon: CircleCheck },
  EXPIRADA: { label: "Vencida", tone: "destructive", icon: TimerOff },
  CANCELADA: { label: "Cancelada", tone: "neutral", icon: Ban },
};
const statusOf = (s: string) => STATUS[s] ?? { label: s, tone: "neutral" as const, icon: CircleX };

const isOpen = (t: Task) => t.status === "CREADA" || t.status === "ASIGNADA";

function OutOfOfficeCard() {
  const queryClient = useQueryClient();
  const ooo = useQuery({ queryKey: ["out-of-office"], queryFn: fetchOutOfOffice });
  const [delegateId, setDelegateId] = useState("");
  const [delegateName, setDelegateName] = useState("");
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: () =>
      setOutOfOffice({
        delegateId: delegateId.trim(),
        delegateName: delegateName.trim() || undefined,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Fuera de oficina activado. Las nuevas firmas se delegarán.");
      queryClient.invalidateQueries({ queryKey: ["out-of-office"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const clear = useMutation({
    mutationFn: clearOutOfOffice,
    onSuccess: () => {
      toast.success("Fuera de oficina desactivado.");
      queryClient.invalidateQueries({ queryKey: ["out-of-office"] });
    },
  });

  const active = ooo.data ?? null;

  return (
    <details className="group mt-8 rounded-lg border border-border bg-background" open={active ? true : undefined}>
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="font-medium">Fuera de oficina</span>
        {active ? (
          <Badge variant="pending">Activo · suplente: {active.delegateName ?? active.delegateId}</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">Desactivado</span>
        )}
        <span className="ml-auto text-sm text-muted-foreground group-open:hidden">Configurar</span>
      </summary>
      <div className="border-t border-border px-4 py-4">
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Mientras esté activo, cada nueva solicitud de firma dirigida a ti se delega automáticamente en tu suplente. Queda
          registrado en la auditoría.
        </p>

        {active ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span>Suplente: {active.delegateName ?? active.delegateId}</span>
            {active.reason ? <span className="text-muted-foreground">· {active.reason}</span> : null}
            <Button variant="outline" className="sm:ml-auto" onClick={() => clear.mutate()} disabled={clear.isPending}>
              Desactivar fuera de oficina
            </Button>
          </div>
        ) : (
          <form
            className="mt-4 grid gap-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!delegateId.trim()) return toast.error("Indica el usuario suplente.");
              save.mutate();
            }}
          >
            <Field label="Usuario suplente" htmlFor="ooo-id" hint="Su identificador de usuario.">
              <Input id="ooo-id" value={delegateId} onChange={(e) => setDelegateId(e.target.value)} />
            </Field>
            <Field label="Nombre del suplente" htmlFor="ooo-name" optional>
              <Input id="ooo-name" value={delegateName} onChange={(e) => setDelegateName(e.target.value)} />
            </Field>
            <Field label="Motivo" htmlFor="ooo-reason" optional>
              <Input id="ooo-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Activando…" : "Activar fuera de oficina"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

function DelegateBox({ task, onDone }: { task: Task; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [toName, setToName] = useState("");
  const delegate = useMutation({
    mutationFn: () => delegateRequest(task.signatureRequestId, buildDelegatePayload(to, toName)),
    onSuccess: () => {
      toast.success("Firma delegada.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form
      className="mt-6 space-y-4 border-t border-border pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!to.trim()) return toast.error("Indica a quién delegar.");
        delegate.mutate();
      }}
    >
      <h3 className="text-base font-semibold">Delegar esta firma</h3>
      <Field label="Usuario destino" htmlFor={`del-${task.id}`} hint="Quien recibirá la firma en tu lugar.">
        <Input id={`del-${task.id}`} value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
      <Field label="Nombre" htmlFor={`del-name-${task.id}`} optional>
        <Input id={`del-name-${task.id}`} value={toName} onChange={(e) => setToName(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" disabled={delegate.isPending}>
        {delegate.isPending ? "Delegando…" : "Delegar firma"}
      </Button>
    </form>
  );
}

function TaskRow({
  task,
  busy,
  onAdvance,
  onChanged,
}: {
  task: Task;
  busy: boolean;
  onAdvance: (to: string) => void;
  onChanged: () => void;
}) {
  const st = statusOf(task.status);
  const Icon = st.icon;
  const open = isOpen(task);
  return (
    <li className={cn("flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center", task.escalatedAt && "border-l-4 border-l-destructive")}>
      <div className="min-w-0 flex-1">
        <p className={cn("text-base", open ? "font-semibold" : "font-medium text-muted-foreground")}>{task.name}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant={st.tone}>
            <Icon className="size-3.5" aria-hidden />
            {st.label}
          </Badge>
          {open ? <DueLabel expiresAt={task.dueDate} /> : null}
          {task.escalatedAt ? (
            <Badge variant="destructive">
              <CircleAlert className="size-3.5" aria-hidden />
              Escalada
            </Badge>
          ) : (task.priority ?? 0) > 0 ? (
            <Badge variant="outline">Prioridad {task.priority}</Badge>
          ) : task.remindersSent ? (
            <Badge variant="outline">
              {task.remindersSent === 1 ? "1 recordatorio" : `${task.remindersSent} recordatorios`}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {st.next ? (
          <Button disabled={busy} variant={task.status === "CREADA" ? "default" : "outline"} onClick={() => onAdvance(st.next!.to)}>
            {st.next.cta}
          </Button>
        ) : null}
        <Sheet>
          <SheetTrigger className="inline-flex h-11 items-center rounded-md border border-border bg-background px-4 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            Ver detalle
          </SheetTrigger>
          <SheetContent title={task.name} className="overflow-y-auto p-6">
            <h2 className="text-xl font-semibold leading-tight">{task.name}</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Estado</dt>
                <dd>{st.label}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Responsable</dt>
                <dd>{task.claimedBy ? `Tomada por ${task.claimedBy}` : "Sin tomar"}</dd>
              </div>
              {task.delegatedFrom ? (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Delegada por</dt>
                  <dd>{task.delegatedFrom}</dd>
                </div>
              ) : null}
              {task.dueDate ? (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Vence</dt>
                  <dd>{new Date(task.dueDate).toLocaleString("es-MX")}</dd>
                </div>
              ) : null}
              {task.escalatedAt ? (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Escalada</dt>
                  <dd className="font-medium text-destructive">{new Date(task.escalatedAt).toLocaleString("es-MX")}</dd>
                </div>
              ) : null}
            </dl>
            <Button className="mt-6 w-full" asChild>
              <Link href="/inbox">Ir a Por firmar</Link>
            </Button>
            <DelegateBox task={task} onDone={onChanged} />
          </SheetContent>
        </Sheet>
      </div>
    </li>
  );
}

export default function TasksPage() {
  const { signerId } = useSession();
  const queryClient = useQueryClient();
  const [view, setView] = useState<"list" | "board">("list");
  const tasks = useQuery({
    queryKey: ["human-tasks", signerId],
    queryFn: () => apiClient.get<Task[]>(`/tasks?assignee=${encodeURIComponent(signerId)}`),
  });
  const complete = useMutation({
    mutationFn: (id: string) => apiClient.post(`/tasks/${id}/complete`, { outcome: "COMPLETADA" }),
    onSuccess: () => {
      toast.success("Tarea completada.");
      queryClient.invalidateQueries({ queryKey: ["human-tasks"] });
    },
  });
  const claim = useMutation({
    mutationFn: (id: string) => apiClient.post(`/tasks/${id}/claim`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["human-tasks"] }),
  });

  function onMove(taskId: string, status: string) {
    if (status === "COMPLETADA") complete.mutate(taskId);
    if (status === "ASIGNADA") claim.mutate(taskId);
  }

  const rows = tasks.data ?? [];
  const open = rows.filter(isOpen);
  const done = rows.filter((t) => !isOpen(t));
  const busy = complete.isPending || claim.isPending;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["human-tasks"] });

  return (
    <AppShell title="Tareas">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Tareas"
          description={
            tasks.isLoading
              ? "Cargando tus tareas…"
              : open.length > 0
                ? `${open.length === 1 ? "Tienes 1 tarea pendiente" : `Tienes ${open.length} tareas pendientes`}. Toma una para empezar y márcala como hecha al terminar.`
                : "Aquí aparecen las tareas de los procesos que te asignan."
          }
          actions={
            <div role="group" aria-label="Forma de ver las tareas" className="inline-flex rounded-md border border-border bg-background p-0.5">
              {(
                [
                  { id: "list", label: "Lista", icon: List },
                  { id: "board", label: "Tablero", icon: LayoutGrid },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={view === o.id}
                  onClick={() => setView(o.id)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-[6px] px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    view === o.id ? "bg-foreground font-medium text-background" : "text-foreground hover:bg-muted",
                  )}
                >
                  <o.icon className="size-4" aria-hidden />
                  {o.label}
                </button>
              ))}
            </div>
          }
        />

        {tasks.isLoading ? (
          <div className="divide-y divide-border rounded-lg border border-border" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
                <Skeleton className="h-11 w-32" />
              </div>
            ))}
          </div>
        ) : tasks.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-5 text-sm">
            <span>No pudimos cargar tus tareas.</span>
            <Button size="sm" variant="outline" onClick={() => tasks.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ListChecks />}
            title="No tienes tareas asignadas"
            description="Cuando un proceso te asigne una tarea, aparecerá aquí con el botón para tomarla. Mientras tanto, revisa si tienes algo por firmar."
            action={
              <Button asChild variant="outline">
                <Link href="/inbox">Ir a Por firmar</Link>
              </Button>
            }
          />
        ) : view === "board" ? (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Arrastra una tarjeta a «En curso» para tomarla o a «Hecha» para completarla.
            </p>
            <TaskKanban
              tasks={rows.map((t) => ({
                id: t.id,
                name: t.name,
                status: t.status,
                dueDate: t.dueDate,
                signatureRequestId: t.signatureRequestId,
              }))}
              onMove={onMove}
            />
          </>
        ) : (
          <div className="space-y-8">
            <section aria-labelledby="t-open">
              <h2 id="t-open" className="mb-3 text-base font-semibold">
                Pendientes <span className="font-normal tabular-nums text-muted-foreground">({open.length})</span>
              </h2>
              {open.length === 0 ? (
                <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No tienes tareas pendientes.</p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
                  {open.map((t) => (
                    <TaskRow key={t.id} task={t} busy={busy} onAdvance={(to) => onMove(t.id, to)} onChanged={invalidate} />
                  ))}
                </ul>
              )}
            </section>
            {done.length > 0 ? (
              <section aria-labelledby="t-done">
                <h2 id="t-done" className="mb-3 text-base font-semibold">
                  Terminadas <span className="font-normal tabular-nums text-muted-foreground">({done.length})</span>
                </h2>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
                  {done.map((t) => (
                    <TaskRow key={t.id} task={t} busy={busy} onAdvance={(to) => onMove(t.id, to)} onChanged={invalidate} />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}

        <OutOfOfficeCard />
      </div>
    </AppShell>
  );
}
