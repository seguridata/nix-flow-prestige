"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { EvidencePanel } from "@/components/inbox/evidence-panel";
import { SignerRail } from "@/components/inbox/signer-rail";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { groupEnvelopes, statusSentence, type EnvelopeRow } from "@/libs/envelope-status";
import { cn } from "@/libs/utils";
import { fetchInbox, fetchSent } from "@/services/inbox-service";
import { useSession } from "@/store/session-store";

function EnvelopeItem({
  row,
  selected,
  onSelect,
}: {
  row: EnvelopeRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <div
        className={cn(
          "rounded-lg border bg-background p-4 transition-colors duration-150",
          selected ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/40",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={onSelect}
            aria-current={selected ? "true" : undefined}
            className="min-w-0 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="block truncate text-base font-semibold">{row.caseTitle || row.documentTitle}</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">{statusSentence(row)}</span>
          </button>
          {row.actionable ? (
            <Button asChild size="sm" className="shrink-0">
              <Link href={`/documents/${row.documentId}/firmar`}>Revisar y firmar</Link>
            </Button>
          ) : null}
        </div>
        {row.signers && row.signers.length > 0 ? (
          <div className="mt-4">
            <SignerRail signers={row.signers} currentSignerId={row.currentSignerId} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function CompactItem({ row, selected, onSelect }: { row: EnvelopeRow; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          selected ? "border-foreground bg-muted/60" : "border-border bg-background hover:bg-muted/40",
        )}
      >
        <span className="min-w-0 truncate text-sm font-medium">{row.caseTitle || row.documentTitle}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{statusSentence(row)}</span>
      </button>
    </li>
  );
}

export default function InboxPage() {
  const { signerId, name } = useSession();
  const inbox = useQuery({ queryKey: ["inbox", signerId], queryFn: () => fetchInbox(signerId) });
  const sent = useQuery({ queryKey: ["sent", signerId], queryFn: () => fetchSent(signerId) });
  const [pickedId, setPickedId] = useState<string | null>(null);

  const groups = useMemo(() => groupEnvelopes(inbox.data, sent.data), [inbox.data, sent.data]);
  const all = useMemo(
    () => [...groups.action, ...groups.inProgress, ...groups.closed],
    [groups],
  );
  // El seleccionado es el que el usuario eligió, o el primero que requiere acción.
  const selected = all.find((r) => r.signatureRequestId === pickedId) ?? all[0] ?? null;
  const isLoading = inbox.isLoading || sent.isLoading;
  const firstName = name.split(" ")[0];

  const select = (r: EnvelopeRow) => () => setPickedId(r.signatureRequestId);

  return (
    <AppShell
      title="Bandeja"
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link href="/new">
            <Plus className="size-4" /> Nuevo envío
          </Link>
        </Button>
      }
    >
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {groups.action.length > 0
            ? `${firstName}, ${groups.action.length === 1 ? "tienes 1 sobre que requiere" : `tienes ${groups.action.length} sobres que requieren`} tu acción`
            : `${firstName}, no hay nada que requiera tu acción`}
        </h1>

        {isLoading ? (
          <div className="mt-8 grid gap-4" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-muted/60" />
            ))}
          </div>
        ) : inbox.isError || sent.isError ? (
          <Card className="mt-8 p-6">
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
          </Card>
        ) : all.length === 0 ? (
          <Card className="mt-8 overflow-hidden p-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/empty-inbox.jpg" alt="" className="h-48 w-full object-cover" />
            <div className="px-6 py-8 text-center">
              <p className="text-base font-medium">Todavía no hay sobres</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                Envía un documento a firma o espera a que alguien te envíe uno; aparecerá aquí con su estado y su evidencia.
              </p>
              <Button asChild className="mt-4">
                <Link href="/new">Enviar un documento a firma</Link>
              </Button>
            </div>
          </Card>
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-8">
              {groups.action.length > 0 ? (
                <section aria-labelledby="g-action">
                  <h2 id="g-action" className="mb-3 text-sm font-semibold">
                    Requieren tu acción
                  </h2>
                  <ul className="space-y-3">
                    {groups.action.map((r) => (
                      <EnvelopeItem
                        key={r.signatureRequestId}
                        row={r}
                        selected={selected?.signatureRequestId === r.signatureRequestId}
                        onSelect={select(r)}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              {groups.inProgress.length > 0 ? (
                <section aria-labelledby="g-progress">
                  <h2 id="g-progress" className="mb-3 text-sm font-semibold">
                    En curso ({groups.inProgress.length})
                  </h2>
                  <ul className="space-y-3">
                    {groups.inProgress.map((r) => (
                      <EnvelopeItem
                        key={r.signatureRequestId}
                        row={r}
                        selected={selected?.signatureRequestId === r.signatureRequestId}
                        onSelect={select(r)}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              {groups.closed.length > 0 ? (
                <section aria-labelledby="g-closed">
                  <h2 id="g-closed" className="mb-3 text-sm font-semibold">
                    Cerrados ({groups.closed.length})
                  </h2>
                  <ul className="space-y-2">
                    {groups.closed.map((r) => (
                      <CompactItem
                        key={r.signatureRequestId}
                        row={r}
                        selected={selected?.signatureRequestId === r.signatureRequestId}
                        onSelect={select(r)}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            {selected ? (
              <aside className="rounded-lg bg-muted/60 p-5 lg:sticky lg:top-6 lg:self-start">
                <EvidencePanel key={selected.signatureRequestId} row={selected} />
              </aside>
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
