"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Activity, Fingerprint, GitBranch, UserPlus, Workflow } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Timeline } from "@/components/ui/timeline";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { apiClient } from "@/services/api-client";
import { fetchInbox } from "@/services/inbox-service";
import { useSession } from "@/store/session-store";

interface Summary {
  requests: number;
  completed: number;
  pendingTasks: number;
  runs: number;
}

interface Health {
  postgres: boolean;
  objectStorage: boolean;
  temporalAddress: string;
  adapters: { method: string; configured: boolean }[];
}

interface OnboardingRow {
  id: string;
  fullName: string;
  status: string;
  createdAt: string;
}

interface OverviewData {
  byRequest: Record<string, number>;
  byOnboarding: Record<string, number>;
  attention: {
    slaRisk: { id: string; documentId: string; status: string; expiresAt: string | null; requestedByName: string | null }[];
    overdueTasks: { id: string; name: string; dueAt: string | null }[];
    reviewOnboarding: { id: string; fullName: string; status: string }[];
    brokenRuns: { id: string; workflowId: string; status: string; lastError: string | null }[];
  };
  activity: { id: string; action: string; actorName: string | null; createdAt: string; documentId: string | null; onboardingId: string | null }[];
}

const COLORS = ["#84BD00", "#191919", "#5B6770", "#E3E3E3"];

export default function OverviewPage() {
  const { signerId } = useSession();
  const summary = useQuery({ queryKey: ["ops-summary"], queryFn: () => apiClient.get<Summary>("/operations/summary") });
  const health = useQuery({ queryKey: ["ops-health"], queryFn: () => apiClient.get<Health>("/operations/health") });
  const onboarding = useQuery({ queryKey: ["onboarding"], queryFn: () => apiClient.get<OnboardingRow[]>("/onboarding") });
  const board = useQuery({ queryKey: ["ops-overview"], queryFn: () => apiClient.get<OverviewData>("/operations/overview") });
  const inbox = useQuery({ queryKey: ["inbox", signerId], queryFn: () => fetchInbox(signerId) });

  const pie = [
    { name: "Completadas", value: summary.data?.completed ?? 0 },
    { name: "Abiertas", value: Math.max((summary.data?.requests ?? 0) - (summary.data?.completed ?? 0), 0) },
    { name: "Tareas", value: summary.data?.pendingTasks ?? 0 },
  ];

  const tiles = [
    { label: "Solicitudes", value: summary.data?.requests ?? "—", icon: Activity, href: "/sent" },
    { label: "Completadas", value: summary.data?.completed ?? "—", icon: Workflow, href: "/sent" },
    { label: "Tareas", value: summary.data?.pendingTasks ?? "—", icon: Fingerprint, href: "/tasks" },
    { label: "Altas M16", value: onboarding.data?.length ?? "—", icon: UserPlus, href: "/onboarding" },
  ];

  return (
    <AppShell title="Overview">
      <div className="mx-auto max-w-6xl" data-tour="overview">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Tablero</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Operación de Prestige</h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Un vistazo a firma, onboarding y Temporal. Workflow no firma; aquí se ve el expediente.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/onboarding">Nueva alta</Link>
            </Button>
            <Button asChild>
              <Link href="/new">Enviar documento</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile, i) => (
            <motion.div
              key={tile.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.22, ease: [0.215, 0.61, 0.355, 1] }}
            >
              <Link href={tile.href as "/inbox"}>
                <div className="bezel h-full">
                  <Card className="glass h-full p-5 transition-transform duration-150 hover:-translate-y-0.5">
                    <tile.icon className="size-4 text-primary" strokeWidth={1.75} />
                    <p className="mt-4 font-mono text-3xl font-semibold tabular-nums">{tile.value}</p>
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{tile.label}</p>
                  </Card>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="glass p-6">
            <h2 className="text-sm font-semibold">Composición</h2>
            <div className="mt-4 h-56">
              {summary.isLoading ? (
                <Skeleton className="h-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pie} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2}>
                      {pie.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
          <Card className="glass p-6">
            <h2 className="text-sm font-semibold">Infra</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="flex justify-between">
                Postgres
                <span className="font-mono">{health.data?.postgres ? "ok" : "—"}</span>
              </li>
              <li className="flex justify-between">
                MinIO
                <span className="font-mono">{health.data?.objectStorage ? "conectado" : "local"}</span>
              </li>
              <li className="flex justify-between gap-3">
                Temporal
                <HoverCard>
                  <HoverCardTrigger className="cursor-help truncate font-mono text-xs underline-offset-2 hover:underline">
                    {health.data?.temporalAddress ?? "…"}
                  </HoverCardTrigger>
                  <HoverCardContent>
                    Motor durable. Señales de firma y timers de SLA. Abrir UI en :8088.
                  </HoverCardContent>
                </HoverCard>
              </li>
            </ul>
            <Button asChild variant="outline" size="sm" className="mt-5">
              <Link href="/operations">Centro de operación</Link>
            </Button>
          </Card>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card className="glass p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Por firmar</h2>
              <Button asChild variant="ghost" size="sm">
                <Link href="/inbox">Bandeja</Link>
              </Button>
            </div>
            <ul className="mt-4 space-y-3">
              {(inbox.data ?? []).slice(0, 4).map((item) => (
                <li key={item.signatureRequestId}>
                  <Link href={`/documents/${item.documentId}`} className="block rounded-md px-2 py-2 hover:bg-muted">
                    <p className="text-sm font-medium">{item.caseTitle || item.documentTitle}</p>
                    <p className="text-xs text-muted-foreground">{item.myStatus}</p>
                  </Link>
                </li>
              ))}
              {(inbox.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nada en bandeja.</p>
              ) : null}
            </ul>
          </Card>
          <Card className="glass p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Actividad reciente</h2>
              <GitBranch className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-4">
              <Timeline
                items={(board.data?.activity ?? []).slice(0, 6).map((event) => ({
                  id: event.id,
                  title: event.action,
                  meta: `${event.actorName ?? event.action} · ${new Date(event.createdAt).toLocaleString("es-MX")}`,
                }))}
              />
            </div>
          </Card>
        </div>

        <Card className="glass mt-6 p-6">
          <h2 className="text-sm font-semibold">Cola de atención</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">SLA en riesgo</p>
              <ul className="mt-2 space-y-2 text-sm">
                {(board.data?.attention.slaRisk ?? []).map((row) => (
                  <li key={row.id}>
                    <Link href={`/documents/${row.documentId}`} className="hover:underline">
                      {row.requestedByName ?? row.id.slice(0, 8)} · {row.status}
                    </Link>
                  </li>
                ))}
                {(board.data?.attention.slaRisk ?? []).length === 0 ? (
                  <li className="text-muted-foreground">Ninguna solicitud vence en 24 h.</li>
                ) : null}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Altas en revisión</p>
              <ul className="mt-2 space-y-2 text-sm">
                {(board.data?.attention.reviewOnboarding ?? []).map((row) => (
                  <li key={row.id}>
                    <Link href={`/onboarding/${row.id}`} className="hover:underline">
                      {row.fullName}
                    </Link>
                  </li>
                ))}
                {(board.data?.attention.reviewOnboarding ?? []).length === 0 ? (
                  <li className="text-muted-foreground">Nada pendiente de RH.</li>
                ) : null}
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
