"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Activity, Database, Fingerprint, HardDrive, Workflow } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/services/api-client";

interface Health {
  postgres: boolean;
  objectStorage: boolean;
  temporalAddress: string;
  adapters: { method: string; configured: boolean; reason?: string }[];
}

interface Summary {
  requests: number;
  completed: number;
  pendingTasks: number;
  runs: number;
}

interface WorkflowRun {
  id: string;
  signatureRequestId: string;
  workflowId: string;
  processKey: string;
  status: string;
  lastError?: string | null;
  createdAt: string;
}

export default function OperationsPage() {
  const health = useQuery({ queryKey: ["ops-health"], queryFn: () => apiClient.get<Health>("/operations/health") });
  const summary = useQuery({ queryKey: ["ops-summary"], queryFn: () => apiClient.get<Summary>("/operations/summary") });
  const runs = useQuery({
    queryKey: ["workflow-runs"],
    queryFn: () => apiClient.get<WorkflowRun[]>("/workflows"),
  });

  const tiles = [
    { label: "Solicitudes", value: summary.data?.requests ?? "—", icon: Activity },
    { label: "Completadas", value: summary.data?.completed ?? "—", icon: Workflow },
    { label: "Tareas abiertas", value: summary.data?.pendingTasks ?? "—", icon: Fingerprint },
    { label: "Flujos Temporal", value: summary.data?.runs ?? "—", icon: Database },
  ];

  return (
    <AppShell title="Centro de operación">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-semibold tracking-tight">Centro de operación</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Salud del BFF, Temporal, MinIO y adaptadores. La biometría espera proveedor; el resto es real.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile, i) => (
            <motion.div
              key={tile.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
            >
              <Card className="glass p-5">
                <tile.icon className="size-4 text-primary" />
                <p className="mt-4 font-mono text-2xl font-semibold tabular-nums">{tile.value}</p>
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{tile.label}</p>
              </Card>
            </motion.div>
          ))}
        </div>

        <Card className="glass mt-6 p-6">
          <h2 className="text-sm font-semibold">Carga de instancias</h2>
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={(runs.data ?? []).reduce<{ name: string; n: number }[]>((acc, run) => {
                  const row = acc.find((r) => r.name === run.status);
                  if (row) row.n += 1;
                  else acc.push({ name: run.status, n: 1 });
                  return acc;
                }, [])}
              >
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="n" fill="#84BD00" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card className="glass p-6">
            <h2 className="text-sm font-semibold">Infraestructura</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="flex justify-between">
                Postgres <span className="font-mono">{health.data?.postgres ? "ok" : "—"}</span>
              </li>
              <li className="flex justify-between">
                MinIO <span className="font-mono">{health.data?.objectStorage ? "conectado" : "local"}</span>
              </li>
              <li className="flex justify-between gap-4">
                Temporal
                <span className="truncate font-mono text-xs">{health.data?.temporalAddress}</span>
              </li>
              <li>
                <a className="text-primary underline-offset-2 hover:underline" href="http://localhost:8088" target="_blank" rel="noreferrer">
                  Abrir Temporal UI
                </a>
              </li>
            </ul>
          </Card>
          <Card className="glass p-6">
            <h2 className="text-sm font-semibold">Adaptadores de firma</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {health.data?.adapters.map((a) => (
                <li key={a.method}>
                  <span className="font-medium">{a.method}</span>
                  <span className="ml-2 text-muted-foreground">{a.configured ? "listo" : a.reason}</span>
                </li>
              )) ?? <li className="text-muted-foreground">Cargando…</li>}
            </ul>
          </Card>
        </div>

        <Card className="glass mt-6 overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold">
            <HardDrive className="size-4" /> Instancias de proceso
          </div>
          <div className="divide-y divide-border">
            {(runs.data ?? []).length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground">Aún no hay flujos. Envía un contrato para crear uno.</p>
            ) : (
              (runs.data ?? []).map((run) => (
                <div key={run.id} className="grid grid-cols-1 gap-1 px-5 py-3 text-sm sm:grid-cols-[1fr_140px_120px]">
                  <span className="font-mono text-xs">{run.workflowId}</span>
                  <span>{run.status}</span>
                  <span className="text-muted-foreground">{new Date(run.createdAt).toLocaleString("es-MX")}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
