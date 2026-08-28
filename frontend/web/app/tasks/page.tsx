"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TaskKanban } from "@/components/bpm/task-kanban";
import { useSession } from "@/store/session-store";
import { apiClient } from "@/services/api-client";

interface Task {
  id: string;
  name: string;
  status: string;
  signerId: string;
  signatureRequestId: string;
  dueDate: string | null;
  claimedBy?: string | null;
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
        {(tasks.data ?? []).length === 0 ? (
          <Card className="p-8 text-sm text-muted-foreground">No hay tareas asignadas.</Card>
        ) : (
          <TaskKanban
            tasks={(tasks.data ?? []).map((t) => ({
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
          {(tasks.data ?? []).slice(0, 6).map((task) => (
            <Sheet key={task.id}>
              <SheetTrigger className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
                Detalle · {task.name}
              </SheetTrigger>
              <SheetContent title={task.name} className="p-6">
                <h2 className="text-lg font-semibold">{task.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">Estado {task.status}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {task.claimedBy ? `Reclamada por ${task.claimedBy}` : "Sin reclamar"}
                </p>
                <Button className="mt-6 w-full" asChild>
                  <Link href="/inbox">Ir a firmar</Link>
                </Button>
              </SheetContent>
            </Sheet>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
