"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CircleAlert, CircleCheck, CircleX, ExternalLink } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

/** Un flujo con error registrado o en un estado de fallo es un problema; el resto, no. */
const isBroken = (r: WorkflowRun) => Boolean(r.lastError) || /FALL|ERROR/i.test(r.status);

const when = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

interface Problem {
  id: string;
  title: string;
  detail: string;
}

export default function OperationsPage() {
  const health = useQuery({ queryKey: ["ops-health"], queryFn: () => apiClient.get<Health>("/operations/health") });
  const summary = useQuery({ queryKey: ["ops-summary"], queryFn: () => apiClient.get<Summary>("/operations/summary") });
  const runs = useQuery({
    queryKey: ["workflow-runs"],
    queryFn: () => apiClient.get<WorkflowRun[]>("/workflows"),
  });

  const runList = runs.data ?? [];
  const loading = health.isLoading || runs.isLoading;
  const loadFailed = health.isError || runs.isError;

  // Problemas primero: servicios caídos y flujos detenidos. Lo demás queda colapsado abajo.
  const problems: Problem[] = [];
  if (health.data && !health.data.postgres) {
    problems.push({ id: "pg", title: "Postgres no responde", detail: "Sin la base de datos no se pueden guardar ni consultar solicitudes." });
  }
  if (health.data && !health.data.objectStorage) {
    problems.push({ id: "minio", title: "MinIO no está conectado", detail: "Los documentos y expedientes no se pueden guardar ni leer." });
  }
  for (const run of runList.filter(isBroken)) {
    problems.push({
      id: run.id,
      title: "Un flujo se detuvo",
      detail: `${run.workflowId}${run.lastError ? `: ${run.lastError}` : ` (${run.status})`}`,
    });
  }

  const counts = runList.reduce<{ name: string; n: number }[]>((acc, run) => {
    const row = acc.find((r) => r.name === run.status);
    if (row) row.n += 1;
    else acc.push({ name: run.status, n: 1 });
    return acc;
  }, []);

  const description = loading
    ? "Revisando el sistema…"
    : loadFailed
      ? "No pudimos revisar todo el sistema. Reintenta antes de dar por buena la salud."
      : problems.length > 0
        ? `${problems.length === 1 ? "Hay 1 problema" : `Hay ${problems.length} problemas`} que atender. Aparecen primero.`
        : "Todo en orden. Aquí puedes revisar el detalle del sistema cuando lo necesites.";

  return (
    <AppShell title="Operación">
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Operación" description={description} />

        <section aria-labelledby="atencion">
          <h2 id="atencion" className="mb-3 text-xl font-semibold tracking-tight">
            Requiere atención
          </h2>
          {loading ? (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          ) : loadFailed ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-foreground p-4 text-sm">
              <CircleAlert className="size-5 shrink-0 text-destructive" aria-hidden />
              <span>No pudimos consultar el estado del sistema.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void health.refetch();
                  void runs.refetch();
                }}
              >
                Reintentar
              </Button>
            </div>
          ) : problems.length === 0 ? (
            <p className="flex items-center gap-2.5 rounded-lg border border-border bg-background p-4 text-sm">
              <CircleCheck className="size-5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium">Sin problemas.</span> Los servicios responden y no hay flujos detenidos.
              </span>
            </p>
          ) : (
            <ul className="space-y-2">
              {problems.map((p) => (
                <li key={p.id} className="flex items-start gap-3 rounded-lg border-2 border-foreground bg-background p-4">
                  <CircleX className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-semibold">{p.title}</p>
                    <p className="mt-0.5 break-words text-sm text-muted-foreground">{p.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">Detalle del sistema</h2>

          <Collapsible title="Servicios" hint={health.data ? "Postgres, MinIO y Temporal" : undefined}>
            <ul className="divide-y divide-border text-sm">
              <ServiceRow name="Postgres" ok={health.data?.postgres} okText="En orden" badText="Sin conexión" />
              <ServiceRow name="MinIO" ok={health.data?.objectStorage} okText="Conectado" badText="No conectado" />
              <li className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>Temporal</span>
                <span className="break-all font-mono text-xs text-muted-foreground">{health.data?.temporalAddress ?? "—"}</span>
              </li>
            </ul>
            <a
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href="http://localhost:8088"
              target="_blank"
              rel="noreferrer"
            >
              Abrir la interfaz de Temporal <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Collapsible>

          <Collapsible title="Métodos de firma disponibles" hint="La biometría espera proveedor; el resto es real.">
            {health.data ? (
              <ul className="divide-y divide-border text-sm">
                {health.data.adapters.map((a) => (
                  <li key={a.method} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span className="font-medium">{a.method}</span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {a.configured ? <CircleCheck className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
                      {a.configured ? "Listo" : (a.reason ?? "Sin configurar")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            )}
          </Collapsible>

          <Collapsible title="Totales" hint="Solicitudes, tareas y flujos">
            <dl className="grid gap-4 sm:grid-cols-4">
              <Total label="Solicitudes" value={summary.data?.requests} />
              <Total label="Completadas" value={summary.data?.completed} />
              <Total label="Tareas abiertas" value={summary.data?.pendingTasks} />
              <Total label="Flujos en Temporal" value={summary.data?.runs} />
            </dl>
          </Collapsible>

          <Collapsible title="Instancias de proceso" hint={runs.data ? `${runList.length} en total` : undefined}>
            {runList.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay flujos. Envía un documento a firma para crear uno.</p>
            ) : (
              <>
                <div className="mb-4 h-44" role="img" aria-label={`Instancias por estado: ${counts.map((c) => `${c.name} ${c.n}`).join(", ")}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={counts}>
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} width={28} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="n" fill="#84BD00" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ul className="divide-y divide-border text-sm">
                  {runList.map((run) => (
                    <li key={run.id} className="grid gap-1 py-3 sm:grid-cols-[1fr_9rem_9rem]">
                      <span className="break-all font-mono text-xs">{run.workflowId}</span>
                      <span className="flex items-center gap-1.5">
                        {isBroken(run) ? <CircleX className="size-4 text-destructive" aria-hidden /> : null}
                        {run.status}
                      </span>
                      <span className="text-muted-foreground">{when.format(new Date(run.createdAt))}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Collapsible>
        </div>
      </div>
    </AppShell>
  );
}

function Collapsible({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-background">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        <span className="font-medium">{title}</span>
        {hint ? <span className="hidden text-sm text-muted-foreground sm:inline">{hint}</span> : null}
      </summary>
      <div className="border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}

function ServiceRow({ name, ok, okText, badText }: { name: string; ok: boolean | undefined; okText: string; badText: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <span>{name}</span>
      <span className="flex items-center gap-1.5">
        {ok === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : ok ? (
          <>
            <CircleCheck className="size-4" aria-hidden /> {okText}
          </>
        ) : (
          <>
            <CircleX className="size-4 text-destructive" aria-hidden /> <span className="font-medium text-destructive">{badText}</span>
          </>
        )}
      </span>
    </li>
  );
}

function Total({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <dd className="text-2xl font-semibold tabular-nums">{value ?? "—"}</dd>
      <dt className="text-sm text-muted-foreground">{label}</dt>
    </div>
  );
}
