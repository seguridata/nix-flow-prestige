"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Eye, MoreHorizontal, Plus, Search, Send } from "lucide-react";
import { toast } from "sonner";

import { DueLabel } from "@/components/inbox/due-label";
import { EnvelopeState } from "@/components/inbox/envelope-state";
import { SignerRail } from "@/components/inbox/signer-rail";
import { StatusFilter, type FilterOption } from "@/components/inbox/status-filter";
import { usePagedInbox } from "@/components/inbox/use-paged-inbox";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { statusSentence } from "@/libs/envelope-status";
import { cn } from "@/libs/utils";
import { filterInboxItems, mergeInboxPages, type InboxItem } from "@/services/inbox-service";
import { cancelRequest } from "@/services/signature-requests-service";
import { useSession } from "@/store/session-store";

type View = "all" | "action" | "progress" | "closed";

const isOpen = (i: InboxItem) => i.status === "PENDIENTE" || i.status === "EN_FIRMA";
/** Para quien envía, lo que pide su decisión es lo que nadie firmó: rechazado o vencido. */
const needsDecision = (i: InboxItem) => i.status === "RECHAZADA" || i.status === "EXPIRADA";

const byDue = (a: InboxItem, b: InboxItem) => {
  const ta = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const tb = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  return ta - tb;
};

export default function SentPage() {
  const { signerId, tenantId } = useSession();
  const [criterion, setCriterion] = useState("");
  const [view, setView] = useState<View>("all");
  const [toCancel, setToCancel] = useState<InboxItem | null>(null);
  const queryClient = useQueryClient();

  const sent = usePagedInbox("sent", tenantId, signerId, criterion);
  const { isLoading } = sent;
  const items = useMemo(() => filterInboxItems(mergeInboxPages(sent.data?.pages), criterion), [sent.data, criterion]);

  // Orden lógico: primero lo que pide decisión, luego lo que sigue abierto (por vencimiento) y al final lo terminado.
  const groups = useMemo(
    () => ({
      action: items.filter(needsDecision),
      progress: items.filter(isOpen).sort(byDue),
      closed: items.filter((i) => !needsDecision(i) && !isOpen(i)),
    }),
    [items],
  );
  const ordered = useMemo(() => [...groups.action, ...groups.progress, ...groups.closed], [groups]);
  const shown = view === "action" ? groups.action : view === "progress" ? groups.progress : view === "closed" ? groups.closed : ordered;

  const options: FilterOption<View>[] = [
    { id: "all", label: "Todos", count: ordered.length },
    { id: "action", label: "Requiere acción", count: groups.action.length },
    { id: "progress", label: "En curso", count: groups.progress.length },
    { id: "closed", label: "Terminados", count: groups.closed.length },
  ];

  const cancelMutation = useMutation({
    mutationFn: (requestId: string) => cancelRequest(requestId, signerId),
    onSuccess: () => {
      toast.success("Solicitud cancelada.");
      setToCancel(null);
      queryClient.invalidateQueries({ queryKey: ["sent", signerId, tenantId] });
      queryClient.invalidateQueries({ queryKey: ["inbox", signerId, tenantId] });
    },
    onError: (error) => {
      setToCancel(null);
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar.");
    },
  });

  const description = isLoading
    ? "Cargando tus envíos…"
    : groups.action.length > 0
      ? `${groups.action.length === 1 ? "1 envío no se completó" : `${groups.action.length} envíos no se completaron`} y espera${groups.action.length === 1 ? "" : "n"} tu decisión. Después, lo que sigue en curso.`
      : groups.progress.length > 0
        ? `${groups.progress.length === 1 ? "1 envío sigue" : `${groups.progress.length} envíos siguen`} en curso: aquí ves quién ya firmó y quién falta.`
        : "Quién ya firmó, quién falta y la cancelación de lo que enviaste.";

  return (
    <AppShell title="Enviados">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Enviados"
          description={description}
          actions={
            <Button asChild>
              <Link href="/new">
                <Plus /> Nuevo envío
              </Link>
            </Button>
          }
        />

        <div className="mb-6 flex flex-col gap-4">
          <StatusFilter label="Filtrar por estado" options={options} value={view} onChange={setView} />
          <Field
            label="Buscar en los envíos cargados"
            htmlFor="sent-search"
            hint="Los resultados se amplían al cargar más envíos."
            className="max-w-xl"
          >
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="sent-search"
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
          <div className="divide-y divide-border rounded-lg border border-border" aria-busy="true" aria-label="Cargando envíos">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-9 w-24" />
              </div>
            ))}
          </div>
        ) : sent.isError && !sent.data ? (
          <div role="alert" className="rounded-lg border border-border p-6">
            <p className="font-medium">No pudimos cargar tus envíos.</p>
            <p className="mt-1 text-sm text-muted-foreground">Revisa tu conexión e inténtalo de nuevo.</p>
            <Button className="mt-4" variant="secondary" onClick={() => void sent.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : ordered.length === 0 ? (
          <EmptyState
            icon={<Send />}
            title={criterion ? "Sin coincidencias en los envíos cargados" : "Todavía no enviaste documentos"}
            description={
              criterion
                ? "Prueba otra búsqueda o carga más envíos para revisar registros anteriores."
                : "Crea un envío para mandar un documento a firma. Aquí verás quién ya firmó y quién falta."
            }
            action={
              criterion ? (
                <Button variant="outline" onClick={() => setCriterion("")}>
                  Limpiar búsqueda
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/new">Nuevo envío</Link>
                </Button>
              )
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Send />}
            title="No hay envíos en esta vista"
            description="Cambia el filtro para ver el resto de tus envíos."
            action={
              <Button variant="outline" onClick={() => setView("all")}>
                Ver todos
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
            {shown.map((item) => {
              const attention = needsDecision(item);
              const open = isOpen(item);
              const title = item.caseTitle || item.documentTitle;
              return (
                <li key={item.signatureRequestId} className={cn("px-4 py-4", attention && "border-l-4 border-l-foreground bg-muted/40")}>
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className={cn("text-base", attention ? "font-semibold" : "font-medium")}>{title}</p>
                      {item.caseTitle && item.documentTitle !== item.caseTitle ? (
                        <p className="text-sm text-muted-foreground">{item.documentTitle}</p>
                      ) : null}
                      <p className="mt-1 text-sm text-muted-foreground">{statusSentence(item)}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <EnvelopeState status={item.status} />
                        {open ? <DueLabel expiresAt={item.expiresAt} /> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild variant={attention ? "default" : "outline"}>
                        <Link href={`/documents/${item.documentId}`}>
                          <Eye /> Ver estado
                        </Link>
                      </Button>
                      {open ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" aria-label={`Más acciones de ${title}`}>
                              <MoreHorizontal /> Más
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem destructive onSelect={() => setToCancel(item)}>
                              <Ban /> Cancelar envío
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </div>
                  {item.signers && item.signers.length > 0 ? (
                    <div className="mt-4 hidden sm:block">
                      <SignerRail signers={item.signers} currentSignerId={item.currentSignerId} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {!isLoading && sent.hasNextPage ? (
          <div className="mt-8 flex flex-col items-center gap-3" aria-live="polite">
            {sent.isFetchNextPageError ? (
              <p role="alert" className="text-sm text-destructive">
                No se pudieron cargar más envíos. Los anteriores siguen disponibles.
              </p>
            ) : null}
            <Button variant="outline" disabled={sent.isFetching} onClick={() => void sent.fetchNextPage()}>
              {sent.isFetchingNextPage ? "Cargando…" : "Cargar más envíos"}
            </Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!toCancel}
        onOpenChange={(o) => !o && !cancelMutation.isPending && setToCancel(null)}
        title={`¿Cancelar «${toCancel ? toCancel.caseTitle || toCancel.documentTitle : ""}»?`}
        description="Los firmantes que aún no firmaron ya no podrán hacerlo. Esta acción no se puede deshacer."
        confirmLabel="Cancelar envío"
        cancelLabel="Mantener envío"
        destructive
        pending={cancelMutation.isPending}
        onConfirm={() => toCancel && cancelMutation.mutate(toCancel.signatureRequestId)}
      />
    </AppShell>
  );
}
