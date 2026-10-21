"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CircleAlert, CircleCheck, FileText, Send, UserRound, Workflow } from "lucide-react";

import { DueLabel } from "@/components/inbox/due-label";
import { EnvelopeState } from "@/components/inbox/envelope-state";
import { SignerRail } from "@/components/inbox/signer-rail";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { groupEnvelopes, statusSentence, type EnvelopeRow } from "@/libs/envelope-status";
import { actionQueue, headline, type ActionItem, type OverviewAttention } from "@/libs/overview";
import { cn } from "@/libs/utils";
import { apiClient } from "@/services/api-client";
import { fetchInbox, fetchSent } from "@/services/inbox-service";
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
}
interface OverviewData {
  attention: OverviewAttention;
}

const OPERATOR_ROLES = ["sender", "rh", "admin"];
const QUEUE_LIMIT = 6;
const IN_PROGRESS_LIMIT = 5;

/** Lo que vence antes va primero; lo que no vence, al final. */
const byDue = (a: EnvelopeRow, b: EnvelopeRow) => {
  const ta = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const tb = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  return ta - tb;
};

export default function OverviewPage() {
  const { signerId, roles, tenantId } = useSession();
  const isOperator = roles.some((r) => OPERATOR_ROLES.includes(r));
  const canSend = roles.includes("sender") || roles.includes("admin");

  const inbox = useQuery({ queryKey: ["inbox", signerId, tenantId], queryFn: () => fetchInbox(signerId) });
  const sent = useQuery({ queryKey: ["sent", signerId, tenantId], queryFn: () => fetchSent(signerId) });
  const board = useQuery({
    queryKey: ["ops-overview"],
    queryFn: () => apiClient.get<OverviewData>("/operations/overview"),
    enabled: isOperator,
  });
  const summary = useQuery({
    queryKey: ["ops-summary"],
    queryFn: () => apiClient.get<Summary>("/operations/summary"),
    enabled: isOperator,
  });
  const health = useQuery({
    queryKey: ["ops-health"],
    queryFn: () => apiClient.get<Health>("/operations/health"),
    enabled: isOperator,
  });
  const onboarding = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => apiClient.get<unknown[]>("/onboarding"),
    enabled: isOperator,
  });

  const groups = useMemo(() => groupEnvelopes(inbox.data, sent.data), [inbox.data, sent.data]);
  const attention = board.data?.attention;
  const signRows = useMemo(() => [...groups.action].sort(byDue), [groups.action]);
  const dueById = useMemo(
    () => new Map(signRows.map((r) => [`firma-${r.signatureRequestId}`, r.expiresAt] as const)),
    [signRows],
  );
  const actions = useMemo(
    () =>
      actionQueue({
        sign: signRows,
        review: attention?.reviewOnboarding ?? [],
        broken: attention?.brokenRuns ?? [],
      }),
    [signRows, attention],
  );
  const inProgress = useMemo(() => [...groups.inProgress].sort(byDue), [groups.inProgress]);

  const loading = inbox.isLoading || (isOperator && board.isLoading);
  // Si algo no cargó no se puede afirmar que todo está al día.
  const failed = inbox.isError || sent.isError || (isOperator && board.isError);
  const title = failed
    ? "No se pudo cargar tu resumen"
    : headline({
        sign: groups.action.length,
        review: attention?.reviewOnboarding.length ?? 0,
        expiring: attention?.slaRisk.length ?? 0,
        broken: attention?.brokenRuns.length ?? 0,
      });
  const description = failed
    ? "Revisa tu conexión e inténtalo de nuevo. Mientras no cargue, no podemos decirte que todo esté al día."
    : loading
      ? undefined
      : actions.length > 0
        ? "Empieza por el primero de la lista: es el más urgente."
        : "No tienes nada pendiente. Aquí verás lo que necesite tu firma o tu revisión.";

  return (
    <AppShell title="Inicio">
      <div className="mx-auto max-w-5xl" data-tour="overview">
        <PageHeader
          title={loading ? <Skeleton className="h-9 w-96 max-w-full" /> : title}
          description={description}
          actions={
            <>
              {roles.includes("rh") || roles.includes("admin") ? (
                <Button asChild variant="outline">
                  <Link href="/onboarding">Nueva alta</Link>
                </Button>
              ) : null}
              {canSend ? (
                <Button asChild>
                  <Link href="/new">Enviar documento</Link>
                </Button>
              ) : null}
            </>
          }
        />

        <section aria-labelledby="accion">
          <h2 id="accion" className="mb-3 flex items-baseline gap-2 text-xl font-semibold tracking-tight">
            Requiere tu acción
            {!loading && actions.length > 0 ? (
              <span className="text-base font-normal tabular-nums text-muted-foreground">{actions.length}</span>
            ) : null}
          </h2>
          <ActionQueue
            items={actions}
            dueById={dueById}
            loading={loading}
            failed={failed}
            onRetry={() => {
              void inbox.refetch();
              void sent.refetch();
              if (isOperator) void board.refetch();
            }}
          />
        </section>

        <section aria-labelledby="curso" className="mt-10">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="curso" className="text-xl font-semibold tracking-tight">
              Mis envíos en curso
            </h2>
            {inProgress.length > IN_PROGRESS_LIMIT ? (
              <Link href="/sent" className="rounded-sm text-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Ver los {inProgress.length} en Enviados
              </Link>
            ) : null}
          </div>
          <InProgressList rows={inProgress.slice(0, IN_PROGRESS_LIMIT)} loading={inbox.isLoading || sent.isLoading} failed={sent.isError} onRetry={() => sent.refetch()} canSend={canSend} />
        </section>

        {isOperator ? (
          <SystemBlock
            health={health.data}
            healthLoading={health.isLoading}
            healthFailed={health.isError}
            summary={summary.data}
            altas={onboarding.data?.length}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

const KIND_ICON = { firmar: FileText, alta: UserRound, flujo: Workflow } as const;
const KIND_TEXT = { firmar: "Firma", alta: "Alta de identidad", flujo: "Flujo detenido" } as const;

/**
 * La cola única. El primer ítem es el más urgente y pesa más (borde grueso y botón con relleno);
 * el resto son filas de lista, no tarjetas repetidas.
 */
function ActionQueue({
  items,
  dueById,
  loading,
  failed,
  onRetry,
}: {
  items: ActionItem[];
  dueById: Map<string, string | null | undefined>;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
    );
  }
  if (failed && items.length === 0) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-5 text-sm">
        <CircleAlert className="size-5 shrink-0 text-destructive" aria-hidden />
        <span>No pudimos cargar lo que requiere tu acción.</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CircleCheck />}
        title="Nada requiere tu acción"
        description="Cuando algo necesite tu firma o tu revisión, aparecerá aquí con un botón para resolverlo."
        className="py-8"
      />
    );
  }
  const [first, ...rest] = items.slice(0, QUEUE_LIMIT);
  return (
    <div>
      {first ? <QueueItem item={first} due={dueById.get(first.id)} lead /> : null}
      {rest.length > 0 ? (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
          {rest.map((item) => (
            <li key={item.id}>
              <QueueItem item={item} due={dueById.get(item.id)} />
            </li>
          ))}
        </ul>
      ) : null}
      {items.length > QUEUE_LIMIT ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Hay {items.length - QUEUE_LIMIT} más.{" "}
          <Link href="/inbox" className="underline underline-offset-4">
            Verlos en Por firmar
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function QueueItem({ item, due, lead = false }: { item: ActionItem; due?: string | null; lead?: boolean }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-center",
        lead ? "rounded-lg border-2 border-foreground bg-background p-5 shadow-subtle" : "bg-background px-4 py-3.5",
      )}
    >
      <span className={cn("grid shrink-0 place-items-center rounded-full bg-muted", lead ? "size-11" : "size-9")}>
        <Icon className={lead ? "size-5" : "size-4"} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground">{KIND_TEXT[item.kind]}</p>
        <p className={cn("leading-snug", lead ? "text-lg font-semibold" : "text-base font-medium")}>{item.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p>
        <DueLabel expiresAt={due} className="mt-1.5" />
      </div>
      <Button asChild variant={lead ? "default" : "outline"} size={lead ? "lg" : "default"} className="w-full shrink-0 sm:w-auto sm:min-w-32">
        <Link href={item.href as never}>
          {item.cta}
          <ChevronRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

function InProgressList({
  rows,
  loading,
  failed,
  onRetry,
  canSend,
}: {
  rows: EnvelopeRow[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  canSend: boolean;
}) {
  if (loading) {
    return (
      <div className="divide-y divide-border rounded-lg border border-border" aria-busy>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="hidden h-5 w-20 md:block" />
          </div>
        ))}
      </div>
    );
  }
  if (failed) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-5 text-sm">
        <span>No pudimos cargar tus envíos.</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Send />}
        title="No tienes envíos en curso"
        description="Cuando envíes un documento a firma, aquí verás quién falta por firmar y cuándo vence."
        action={
          canSend ? (
            <Button asChild variant="outline">
              <Link href="/new">Enviar un documento</Link>
            </Button>
          ) : undefined
        }
        className="py-8"
      />
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
      {rows.map((row) => (
        <li key={row.signatureRequestId}>
          <Link
            href={`/documents/${row.documentId}`}
            className="group grid min-h-14 gap-x-6 gap-y-3 px-4 py-3.5 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(0,1fr)_16rem_auto] md:items-center"
          >
            <div className="min-w-0">
              <p className="truncate text-base font-medium">{row.caseTitle || row.documentTitle}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{statusSentence(row)}</p>
            </div>
            <div className="hidden min-w-0 md:block">
              {row.signers && row.signers.length > 0 ? (
                <SignerRail signers={row.signers} currentSignerId={row.currentSignerId} />
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 md:justify-end">
              <EnvelopeState status={row.status} />
              <DueLabel expiresAt={row.expiresAt} />
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Operación en segundo plano: una línea; se abre sola si hay un problema. */
function SystemBlock({
  health,
  healthLoading,
  healthFailed,
  summary,
  altas,
}: {
  health: Health | undefined;
  healthLoading: boolean;
  healthFailed: boolean;
  summary: Summary | undefined;
  altas: number | undefined;
}) {
  const ok = !!health && health.postgres && health.objectStorage && !healthFailed;
  const problem = !healthLoading && !ok;
  return (
    <details className="group mt-10 rounded-lg border border-border bg-background" open={problem ? true : undefined}>
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {healthLoading ? (
          <span className="text-muted-foreground">Revisando el sistema…</span>
        ) : ok ? (
          <span className="flex items-center gap-2 font-medium">
            <CircleCheck className="size-4" aria-hidden /> Sistema en orden
          </span>
        ) : (
          <span className="flex items-center gap-2 font-medium text-destructive">
            <CircleAlert className="size-4" aria-hidden /> Hay servicios con problemas
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
          Estado del sistema
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        </span>
      </summary>
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-t border-border px-4 py-4 text-sm">
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <Total label="solicitudes" value={summary?.requests} href="/sent" />
          <Total label="completadas" value={summary?.completed} href="/sent" />
          <Total label="tareas abiertas" value={summary?.pendingTasks} href="/tasks" />
          <Total label="altas" value={altas} href="/onboarding" />
        </dl>
        <Link href="/operations" className="rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Abrir Operación
        </Link>
      </div>
    </details>
  );
}

function Total({ label, value, href }: { label: string; value: number | undefined; href: string }) {
  return (
    <Link href={href as never} className="group flex min-h-11 items-baseline gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0">
      <dd className="text-lg font-semibold tabular-nums">{value ?? "—"}</dd>
      <dt className="text-muted-foreground group-hover:text-foreground">{label}</dt>
    </Link>
  );
}
