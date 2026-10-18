"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePagedInbox } from "@/components/inbox/use-paged-inbox";
import { motion } from "motion/react";
import { CheckCircle2, Clock, FilePlus2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/documents/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSession } from "@/store/session-store";
import { filterInboxItems, mergeInboxPages } from "@/services/inbox-service";
import { cancelRequest } from "@/services/signature-requests-service";

export default function SentPage() {
  const { signerId, tenantId } = useSession();
  const [criterion, setCriterion] = useState("");
  const queryClient = useQueryClient();

  const sent = usePagedInbox("sent", tenantId, signerId, criterion);
  const { isLoading } = sent;
  const items = useMemo(() => filterInboxItems(mergeInboxPages(sent.data?.pages), criterion), [sent.data, criterion]);

  const cancelMutation = useMutation({
    mutationFn: (requestId: string) => cancelRequest(requestId, signerId),
    onSuccess: () => {
      toast.success("Solicitud cancelada.");
      queryClient.invalidateQueries({ queryKey: ["sent", signerId, tenantId] });
      queryClient.invalidateQueries({ queryKey: ["inbox", signerId, tenantId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar.");
    },
  });

  return (
    <AppShell
      title="Enviados"
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link href="/new">
            <FilePlus2 className="size-4" /> Nuevo envío
          </Link>
        </Button>
      }
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Documentos enviados
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Seguimiento</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Quién ya firmó, quién falta y cancelación del flujo.
            </p>
          </div>
        </div>

        <div className="mb-6 max-w-xl">
          <label htmlFor="sent-search" className="text-sm font-medium">Buscar en los envíos cargados</label>
          <input id="sent-search" type="search" value={criterion} onChange={event => setCriterion(event.target.value)} placeholder="Documento, expediente, persona o estado"
            className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <p className="mt-2 text-xs text-muted-foreground">Los resultados se amplían al cargar más envíos.</p>
        </div>
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : sent.isError && !sent.data ? (
          <Card className="p-6"><p role="alert">No pudimos cargar tus envíos.</p><Button className="mt-3" variant="outline" onClick={() => void sent.refetch()}>Reintentar</Button></Card>
        ) : items && items.length > 0 ? (
          <div className="flex flex-col gap-4">
            {items.map((item, index) => {
              const canCancel = item.status === "PENDIENTE" || item.status === "EN_FIRMA";
              return (
                <motion.div
                  key={item.signatureRequestId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.2 }}
                >
                  <Card className="glass p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold">{item.caseTitle || item.documentTitle}</h2>
                        <p className="text-sm text-muted-foreground">{item.documentTitle}</p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                    <ul className="mt-4 flex flex-col gap-2">
                      {(item.signers ?? []).map((signer) => (
                        <li key={signer.signerId} className="flex items-center gap-2 text-sm">
                          {signer.status === "FIRMADO" ? (
                            <CheckCircle2 className="size-4 text-success" />
                          ) : (
                            <Clock className="size-4 text-muted-foreground" />
                          )}
                          <span>{signer.name ?? signer.signerId}</span>
                          <span className="text-xs text-muted-foreground">
                            {signer.status === "FIRMADO" ? "firmó" : "falta"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={`/documents/${item.documentId}`}>Ver estado</Link>
                      </Button>
                      {canCancel ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => cancelMutation.mutate(item.signatureRequestId)}
                          disabled={cancelMutation.isPending}
                        >
                          Cancelar envío
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <Card className="glass p-10 text-center">
            <p className="font-medium">{criterion ? "Sin coincidencias en los envíos cargados" : "Todavía no enviaste documentos"}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {criterion ? "Prueba otra búsqueda o carga más envíos para revisar registros anteriores." : "Crea un envío para mandar un documento a firma."}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Button asChild>
                <Link href="/new">Nuevo envío</Link>
              </Button>
            </div>
          </Card>
        )}
        {!isLoading && sent.hasNextPage ? <div className="mt-8 flex flex-col items-center gap-3" aria-live="polite">
          {sent.isFetchNextPageError ? <p role="alert" className="text-sm text-destructive">No se pudieron cargar más envíos. Los anteriores siguen disponibles.</p> : null}
          <Button variant="outline" disabled={sent.isFetching} onClick={() => void sent.fetchNextPage()}>{sent.isFetchingNextPage ? "Cargando…" : "Cargar más envíos"}</Button>
        </div> : null}
      </div>
    </AppShell>
  );
}
