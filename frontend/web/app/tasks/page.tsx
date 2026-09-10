"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TaskKanban } from "@/components/bpm/task-kanban";
import { useSession } from "@/store/session-store";
import { apiClient } from "@/services/api-client";
import { delegateRequest } from "@/services/signature-requests-service";
import {
  clearOutOfOffice,
  fetchOutOfOffice,
  setOutOfOffice,
} from "@/services/availability-service";

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
    <Card className="mb-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Fuera de oficina</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Mientras esté activo, cada nueva solicitud de firma dirigida a ti se delega
            automáticamente en tu suplente (queda registrado en la auditoría).
          </p>
        </div>
        {active ? (
          <Badge variant="outline" className="shrink-0">
            Activo → {active.delegateName ?? active.delegateId}
          </Badge>
        ) : null}
      </div>

      {active ? (
        <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span>Suplente: {active.delegateName ?? active.delegateId}</span>
          {active.reason ? <span>· {active.reason}</span> : null}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => clear.mutate()}
            disabled={clear.isPending}
          >
            Desactivar
          </Button>
        </div>
      ) : (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!delegateId.trim()) return toast.error("Indica el usuario suplente.");
            save.mutate();
          }}
        >
          <Input
            placeholder="Usuario suplente (signerId)"
            value={delegateId}
            onChange={(e) => setDelegateId(e.target.value)}
          />
          <Input
            placeholder="Nombre del suplente (opcional)"
            value={delegateName}
            onChange={(e) => setDelegateName(e.target.value)}
          />
          <Input
            placeholder="Motivo (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="sm:col-span-3">
            <Button type="submit" size="sm" disabled={save.isPending}>
              Activar fuera de oficina
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function DelegateBox({ task, onDone }: { task: Task; onDone: () => void }) {
  const { signerId } = useSession();
  const [to, setTo] = useState("");
  const [toName, setToName] = useState("");
  const delegate = useMutation({
    mutationFn: () =>
      delegateRequest(task.signatureRequestId, {
        fromSignerId: signerId,
        toSignerId: to.trim(),
        toName: toName.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Firma delegada.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form
      className="mt-6 space-y-2 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!to.trim()) return toast.error("Indica a quién delegar.");
        delegate.mutate();
      }}
    >
      <p className="text-xs font-medium">Delegar esta firma</p>
      <Input placeholder="Usuario destino (signerId)" value={to} onChange={(e) => setTo(e.target.value)} />
      <Input placeholder="Nombre (opcional)" value={toName} onChange={(e) => setToName(e.target.value)} />
      <Button type="submit" size="sm" variant="outline" disabled={delegate.isPending}>
        Delegar
      </Button>
    </form>
  );
}

export default function TasksPage() {
  const { signerId } = useSession();
  const queryClient = useQueryClient();
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
    mutationFn: (id: string) => apiClient.post(`/tasks/${id}/claim`, { userId: signerId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["human-tasks"] }),
  });

  function onMove(taskId: string, status: string) {
    if (status === "COMPLETADA") complete.mutate(taskId);
    if (status === "ASIGNADA") claim.mutate(taskId);
  }

  const rows = tasks.data ?? [];

  return (
    <AppShell title="Tareas humanas">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Tablero de tareas</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Arrastra entre columnas (dnd-kit). Completar dispara el API real, no un mock.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/inbox">Bandeja de firma</Link>
          </Button>
        </div>

        <OutOfOfficeCard />

        {rows.length === 0 ? (
          <Card className="p-8 text-sm text-muted-foreground">No hay tareas asignadas.</Card>
        ) : (
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
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {rows.slice(0, 8).map((task) => (
            <Sheet key={task.id}>
              <SheetTrigger className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
                Detalle · {task.name}
                {task.escalatedAt ? (
                  <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                    Escalada
                  </Badge>
                ) : (task.priority ?? 0) > 0 ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    Prioridad {task.priority}
                  </Badge>
                ) : task.remindersSent ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {task.remindersSent} recordatorio(s)
                  </Badge>
                ) : null}
              </SheetTrigger>
              <SheetContent title={task.name} className="p-6">
                <h2 className="text-lg font-semibold">{task.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">Estado {task.status}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {task.claimedBy ? `Reclamada por ${task.claimedBy}` : "Sin reclamar"}
                </p>
                {task.delegatedFrom ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Delegada por {task.delegatedFrom}
                  </p>
                ) : null}
                {task.dueDate ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Vence {new Date(task.dueDate).toLocaleString("es-MX")}
                  </p>
                ) : null}
                {task.escalatedAt ? (
                  <p className="mt-1 text-xs text-red-500">
                    Escalada el {new Date(task.escalatedAt).toLocaleString("es-MX")}
                  </p>
                ) : null}
                <Button className="mt-6 w-full" asChild>
                  <Link href="/inbox">Ir a firmar</Link>
                </Button>
                <DelegateBox
                  task={task}
                  onDone={() => queryClient.invalidateQueries({ queryKey: ["human-tasks"] })}
                />
              </SheetContent>
            </Sheet>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
