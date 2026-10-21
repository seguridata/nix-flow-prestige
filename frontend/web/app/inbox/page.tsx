"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Inbox, Plus, Search } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { DueLabel } from "@/components/inbox/due-label";
import { EnvelopeState } from "@/components/inbox/envelope-state";
import { EvidencePanel } from "@/components/inbox/evidence-panel";
import { SignerRail } from "@/components/inbox/signer-rail";
import { StatusFilter, type FilterOption } from "@/components/inbox/status-filter";
import { usePagedInbox } from "@/components/inbox/use-paged-inbox";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { groupEnvelopes, statusSentence, type EnvelopeRow } from "@/libs/envelope-status";
import { cn } from "@/libs/utils";
import { filterInboxItems, mergeInboxPages } from "@/services/inbox-service";
import { useSession } from "@/store/session-store";

type View = "all" | "action" | "progress" | "closed";

/** Lo que vence antes va primero; lo que no vence, al final. */
const byDue = (a: EnvelopeRow, b: EnvelopeRow) => {
  const ta = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const tb = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  return ta - tb;
};

/** Fila que requiere acción: pesa más que el resto (borde grueso, botón con relleno). */
function ActionRow({ row, selected, onSelect }: { row: EnvelopeRow; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <div
        className={cn(
          "rounded-lg border-2 bg-background p-4 shadow-subtle sm:p-5",
          selected ? "border-foreground bg-muted/50" : "border-foreground",
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <button
            type="button"
            onClick={onSelect}
            aria-current={selected ? "true" : undefined}
            className="min-w-0 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="block text-lg font-semibold leading-snug">{row.caseTitle || row.documentTitle}</span>
            <span className="mt-1 block text-sm text-muted-foreground">{statusSentence(row)}</span>
            <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <EnvelopeState status={row.status} actionable />
              <DueLabel expiresAt={row.expiresAt} />
            </span>
          </button>
          <Button asChild size="lg" className="w-full shrink-0 sm:w-auto">
            <Link href={`/documents/${row.documentId}/firmar`}>Firmar</Link>
          </Button>
        </div>
        {row.signers && row.signers.length > 0 ? (
          <div className="mt-4 border-t border-border pt-4">
            <SignerRail signers={row.signers} currentSignerId={row.currentSignerId} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** Fila de lista (en curso o terminada): ligera, sin borde propio, para que la acción destaque. */
function ListRow({ row, selected, onSelect }: { row: EnvelopeRow; selected: boolean; onSelect: () => void }) {
  const finished = row.status !== "PENDIENTE" && row.status !== "EN_FIRMA";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "grid min-h-14 w-full gap-x-4 gap-y-2 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
          selected ? "bg-muted" : "hover:bg-muted/50",
        )}
      >
        <span className="min-w-0">
          <span className={cn("block truncate text-base", finished ? "font-normal" : "font-medium")}>
            {row.caseTitle || row.documentTitle}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{statusSentence(row)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:justify-end">
          <EnvelopeState status={row.status} />
          {finished ? null : <DueLabel expiresAt={row.expiresAt} />}
        </span>
      </button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando sobres">
      <div className="rounded-lg border-2 border-border p-5">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="mt-3 h-4 w-3/4" />
        <Skeleton className="mt-4 h-6 w-32 rounded-full" />
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-4 py-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InboxPage() {
  const { signerId, name, tenantId } = useSession();
  const [criterion, setCriterion] = useState("");
  const [view, setView] = useState<View>("all");
  const inbox = usePagedInbox("inbox", tenantId, signerId, criterion);
  const sent = usePagedInbox("sent", tenantId, signerId, criterion);
  const scope = `${tenantId}:${signerId}:${criterion}`;
  const [picked, setPicked] = useState<{ scope: string; id: string } | null>(null);
  const pickedId = picked?.scope === scope ? picked.id : null;

  const groups = useMemo(() => {
    const g = groupEnvelopes(
      filterInboxItems(mergeInboxPages(inbox.data?.pages), criterion),
      filterInboxItems(mergeInboxPages(sent.data?.pages), criterion),
    );
    return { action: [...g.action].sort(byDue), inProgress: [...g.inProgress].sort(byDue), closed: g.closed };
  }, [inbox.data, sent.data, criterion]);

  const all = useMemo(() => [...groups.action, ...groups.inProgress, ...groups.closed], [groups]);
  const shown = view === "action" ? groups.action : view === "progress" ? groups.inProgress : view === "closed" ? groups.closed : all;
  const showAction = view === "all" || view === "action" ? groups.action : [];
  const showProgress = view === "all" || view === "progress" ? groups.inProgress : [];
  const showClosed = view === "all" || view === "closed" ? groups.closed : [];

  // El seleccionado es el que el usuario eligió (si sigue visible), o el primero de la vista.
  const selected = shown.find((r) => r.signatureRequestId === pickedId) ?? shown[0] ?? null;
  const isLoading = inbox.isLoading || sent.isLoading;
  const firstName = name.split(" ")[0];

  const select = (r: EnvelopeRow) => () => setPicked({ scope, id: r.signatureRequestId });

  const options: FilterOption<View>[] = [
    { id: "all", label: "Todos", count: all.length },
    { id: "action", label: "Requiere acción", count: groups.action.length },
    { id: "progress", label: "En curso", count: groups.inProgress.length },
    { id: "closed", label: "Terminados", count: groups.closed.length },
  ];

  const description = isLoading
    ? "Cargando tus sobres…"
    : groups.action.length > 0
      ? `${firstName}, ${groups.action.length === 1 ? "tienes 1 sobre que requiere" : `tienes ${groups.action.length} sobres que requieren`} tu acción. Van primero, los más urgentes arriba.`
      : `${firstName}, no hay nada que requiera tu acción ahora.`;

  const loadError = (inbox.isError && !inbox.data) || (sent.isError && !sent.data);

  return (
    <AppShell title="Por firmar">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Por firmar"
          description={description}
          actions={
            <Button asChild variant="outline">
              <Link href="/new">
                <Plus /> Nuevo envío
              </Link>
            </Button>
          }
        />

        <div className="mb-6 flex flex-col gap-4">
          <StatusFilter label="Filtrar por estado" options={options} value={view} onChange={setView} />
          <Field
            label="Buscar en los sobres cargados"
            htmlFor="inbox-search"
            hint="Los resultados se amplían al cargar más sobres."
            className="max-w-xl"
          >
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="inbox-search"
                type="search"
                value={criterion}
                onChange={(event) => setCriterion(event.target.value)}
                placeholder="Documento, expediente, persona o estado"
                className="pl-9"
              />
            </div>
          </Field>
        </div>

        {isLoading ? (
          <ListSkeleton />
        ) : loadError ? (
          <div role="alert" className="rounded-lg border border-border p-6">
            <p className="font-medium">No pudimos cargar tus sobres.</p>
            <p className="mt-1 text-sm text-muted-foreground">Revisa tu conexión e inténtalo de nuevo.</p>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => {
                void inbox.refetch();
                void sent.refetch();
              }}
            >
              Reintentar
            </Button>
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title={criterion ? "Sin coincidencias en los sobres cargados" : "Todavía no hay sobres"}
            description={
              criterion
                ? "Prueba otra búsqueda o carga más sobres para revisar registros anteriores."
                : "Envía un documento a firma o espera a que alguien te envíe uno; aparecerá aquí con su estado y su evidencia."
            }
            action={
              criterion ? (
                <Button variant="outline" onClick={() => setCriterion("")}>
                  Limpiar búsqueda
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/new">Enviar un documento a firma</Link>
                </Button>
              )
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title="No hay sobres en esta vista"
            description="Cambia el filtro para ver el resto de tus sobres."
            action={
              <Button variant="outline" onClick={() => setView("all")}>
                Ver todos
              </Button>
            }
          />
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-8">
              {showAction.length > 0 ? (
                <section aria-labelledby="g-action">
                  <h2 id="g-action" className="mb-3 text-base font-semibold">
                    Requieren tu acción <span className="font-normal tabular-nums text-muted-foreground">({showAction.length})</span>
                  </h2>
                  <ul className="space-y-3">
                    {showAction.map((r) => (
                      <ActionRow key={r.signatureRequestId} row={r} selected={selected?.signatureRequestId === r.signatureRequestId} onSelect={select(r)} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {showProgress.length > 0 ? (
                <section aria-labelledby="g-progress">
                  <h2 id="g-progress" className="mb-3 text-base font-semibold">
                    En curso <span className="font-normal tabular-nums text-muted-foreground">({showProgress.length})</span>
                  </h2>
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
                    {showProgress.map((r) => (
                      <ListRow key={r.signatureRequestId} row={r} selected={selected?.signatureRequestId === r.signatureRequestId} onSelect={select(r)} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {showClosed.length > 0 ? (
                <section aria-labelledby="g-closed">
                  <h2 id="g-closed" className="mb-3 text-base font-semibold">
                    Terminados <span className="font-normal tabular-nums text-muted-foreground">({showClosed.length})</span>
                  </h2>
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
                    {showClosed.map((r) => (
                      <ListRow key={r.signatureRequestId} row={r} selected={selected?.signatureRequestId === r.signatureRequestId} onSelect={select(r)} />
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            {selected ? (
              <aside aria-label="Detalle del sobre seleccionado" className="rounded-lg bg-muted/60 p-5 lg:sticky lg:top-6 lg:self-start">
                <EvidencePanel key={selected.signatureRequestId} row={selected} />
              </aside>
            ) : null}
          </div>
        )}
        {!isLoading && (inbox.hasNextPage || sent.hasNextPage) ? (
          <div className="mt-8 flex flex-col items-center gap-3" aria-live="polite">
            {inbox.isFetchNextPageError || sent.isFetchNextPageError ? (
              <p role="alert" className="text-sm text-destructive">
                No se pudieron cargar más sobres. Los anteriores siguen disponibles.
              </p>
            ) : null}
            <Button
              variant="outline"
              disabled={inbox.isFetching || sent.isFetching}
              onClick={() => {
                if (inbox.hasNextPage) void inbox.fetchNextPage();
                if (sent.hasNextPage) void sent.fetchNextPage();
              }}
            >
              {inbox.isFetchingNextPage || sent.isFetchingNextPage ? "Cargando…" : "Cargar más sobres"}
            </Button>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
