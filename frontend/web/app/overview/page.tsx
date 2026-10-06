"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CircleAlert, CircleCheck, Clock, FileText, UserRound, Workflow } from "lucide-react";

import { SignerRail } from "@/components/inbox/signer-rail";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { groupEnvelopes, statusSentence, type EnvelopeRow } from "@/libs/envelope-status";
import {
  actionQueue,
  dueLabel,
  headline,
  openEnvelopes,
  type ActionItem,
  type DueTone,
  type OverviewAttention,
} from "@/libs/overview";
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

export default function OverviewPage() {
  const { signerId, roles } = useSession();
  const isOperator = roles.some((r) => OPERATOR_ROLES.includes(r));

  const inbox = useQuery({ queryKey: ["inbox", signerId], queryFn: () => fetchInbox(signerId) });
  const sent = useQuery({ queryKey: ["sent", signerId], queryFn: () => fetchSent(signerId) });
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
  const rows = useMemo(() => openEnvelopes(groups, 6), [groups]);
  const attention = board.data?.attention;
  const actions = useMemo(
    () =>
      actionQueue({
        sign: groups.action,
        review: attention?.reviewOnboarding ?? [],
        broken: attention?.brokenRuns ?? [],
      }),
    [groups.action, attention],
  );

  const loading = inbox.isLoading || (isOperator && board.isLoading);
  const title = headline({
    sign: groups.action.length,
    review: attention?.reviewOnboarding.length ?? 0,
    expiring: attention?.slaRisk.length ?? 0,
    broken: attention?.brokenRuns.length ?? 0,
  });

  return (
    <AppShell title="Overview">
      <div className="mx-auto max-w-[88rem]" data-tour="overview">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <h1 className="max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {loading ? <Skeleton className="h-10 w-96 max-w-full" /> : title}
          </h1>
          <div className="flex gap-2">
            {roles.includes("rh") || roles.includes("admin") ? (
              <Button asChild variant="outline">
                <Link href="/onboarding">Nueva alta</Link>
              </Button>
            ) : null}
            {roles.includes("sender") || roles.includes("admin") ? (
              <Button asChild>
                <Link href="/new">Enviar documento</Link>
              </Button>
            ) : null}
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-labelledby="sobres">
            <h2 id="sobres" className="sr-only">
              Sobres abiertos
            </h2>
            <EnvelopeList
              rows={rows}
              loading={inbox.isLoading || sent.isLoading}
              failed={inbox.isError}
              onRetry={() => inbox.refetch()}
            />
          </section>

          <aside aria-labelledby="accion" className="order-first lg:order-none lg:border-l lg:border-border lg:pl-8">
            <h2 id="accion" className="text-xl font-semibold tracking-tight">
              Requiere tu acción
            </h2>
            <ActionList items={actions} loading={loading} />
          </aside>
        </div>

        {isOperator ? (
          <footer className="mt-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-t border-border pt-4 text-sm">
            <ServiceStatus health={health.data} loading={health.isLoading} failed={health.isError} />
            <dl className="flex flex-wrap gap-x-8 gap-y-2">
              <Total label="solicitudes" value={summary.data?.requests} href="/sent" />
              <Total label="completadas" value={summary.data?.completed} href="/sent" />
              <Total label="tareas" value={summary.data?.pendingTasks} href="/tasks" />
              <Total label="altas" value={onboarding.data?.length} href="/onboarding" />
            </dl>
          </footer>
        ) : null}
      </div>
    </AppShell>
  );
}

const TONE_TEXT: Record<DueTone, string> = {
  overdue: "text-destructive",
  soon: "text-foreground",
  normal: "text-muted-foreground",
  none: "text-muted-foreground",
};

function EnvelopeList({
  rows,
  loading,
  failed,
  onRetry,
}: {
  rows: EnvelopeRow[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }
  if (failed) {
    return (
      <div role="alert" className="rounded-lg border border-border p-5 text-sm">
        No se pudieron cargar tus sobres.{" "}
        <Button variant="link" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-8">
        <FileText className="size-7 text-muted-foreground" aria-hidden />
        <p className="text-base font-medium">No hay sobres abiertos</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Cuando envíes un documento a firma o te pidan firmar uno, aparecerá aquí con quién falta y cuándo vence.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_9rem] gap-6 px-4 pb-2 text-sm text-muted-foreground md:grid">
        <span>Documento y proceso</span>
        <span>Firmantes</span>
        <span>Vence</span>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => (
          <EnvelopeRowItem key={row.signatureRequestId} row={row} />
        ))}
      </ul>
      <Button asChild variant="link" className="mt-3 px-0">
        <Link href="/inbox">Ver todos en Bandeja</Link>
      </Button>
    </div>
  );
}

function EnvelopeRowItem({ row }: { row: EnvelopeRow }) {
  const due = dueLabel(row.expiresAt);
  const urgent = due.tone === "overdue";
  return (
    <li>
      <Link
        href={`/documents/${row.documentId}`}
        className={cn(
          "group relative grid gap-x-6 gap-y-4 rounded-lg border bg-background p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_9rem]",
          row.actionable ? "border-foreground" : "border-border",
        )}
      >
        {urgent ? <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-destructive" /> : null}
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{row.caseTitle || row.documentTitle}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{statusSentence(row)}</p>
        </div>
        <div className="min-w-0">
          {row.signers && row.signers.length > 0 ? (
            <SignerRail signers={row.signers} currentSignerId={row.currentSignerId} />
          ) : (
            <p className="text-sm text-muted-foreground">Sin información de firmantes</p>
          )}
        </div>
        <div className={cn("flex items-center gap-2 text-sm md:justify-between", TONE_TEXT[due.tone])}>
          <span className="flex items-center gap-1.5">
            <Clock className="size-4 shrink-0" aria-hidden />
            <span className={urgent ? "font-semibold" : undefined}>{due.text}</span>
          </span>
          <ChevronRight className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block" aria-hidden />
        </div>
      </Link>
    </li>
  );
}

const KIND_ICON = { firmar: FileText, alta: UserRound, flujo: Workflow } as const;

function ActionList({ items, loading }: { items: ActionItem[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="mt-4 space-y-3" aria-busy>
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-border p-4 text-sm">
        <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">Nada requiere tu acción</p>
          <p className="mt-0.5 text-muted-foreground">Cuando algo necesite tu firma o tu revisión, aparecerá aquí.</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-3">
      {items.slice(0, 6).map((item, i) => {
        const Icon = KIND_ICON[item.kind];
        return (
          <li key={item.id} className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold leading-snug">{item.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p>
              </div>
            </div>
            <Button asChild variant={i === 0 ? "default" : "outline"} size="sm" className="mt-3 w-full">
              <Link href={item.href as never}>{item.cta}</Link>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function Total({ label, value, href }: { label: string; value: number | undefined; href: string }) {
  return (
    <Link href={href as never} className="group flex items-baseline gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <dd className="text-lg font-semibold tabular-nums">{value ?? "—"}</dd>
      <dt className="text-muted-foreground group-hover:text-foreground">{label}</dt>
    </Link>
  );
}

function ServiceStatus({ health, loading, failed }: { health: Health | undefined; loading: boolean; failed: boolean }) {
  if (loading) return <span className="text-muted-foreground">Revisando servicios…</span>;
  const ok = !!health && health.postgres && health.objectStorage && !failed;
  return (
    <Link href="/operations" className="flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {ok ? <CircleCheck className="size-4" aria-hidden /> : <CircleAlert className="size-4 text-destructive" aria-hidden />}
      <span className="font-medium">{ok ? "Todo en orden" : "Revisa los servicios"}</span>
      <span className="text-muted-foreground">Postgres · MinIO · Temporal</span>
    </Link>
  );
}
