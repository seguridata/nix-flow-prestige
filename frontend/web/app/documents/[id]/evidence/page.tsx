"use client";

import { use, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, RefreshCcw } from "lucide-react";

import { CustodyTimeline, DossierCard } from "@/components/evidence/dossier-card";
import { HashChip } from "@/components/evidence/hash-chip";
import { VerificationReport } from "@/components/evidence/verification-report";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { auditLabel } from "@/libs/envelope-status";
import { TRUST_NOTE } from "@/libs/evidence-checks";
import { apiClient } from "@/services/api-client";
import { fetchDocument } from "@/services/documents-service";
import { fetchEvidenceForRequest, verifyEvidenceManifest } from "@/services/evidence-service";
import { fetchSignatureRequestsForDocument } from "@/services/signature-requests-service";

interface AuditEvent {
  action: string;
  actorId: string;
  actorName?: string | null;
  createdAt: string;
}

const when = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const short = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = use(params);

  const documentQuery = useQuery({ queryKey: ["document", documentId], queryFn: () => fetchDocument(documentId) });
  const requestsQuery = useQuery({
    queryKey: ["signature-requests", "document", documentId],
    queryFn: () => fetchSignatureRequestsForDocument(documentId),
  });

  const request = requestsQuery.data?.[0];
  const completed = request?.status === "COMPLETADA";

  const manifestQuery = useQuery({
    queryKey: ["evidence", "by-request", request?.id],
    queryFn: () => fetchEvidenceForRequest(request!.id),
    enabled: Boolean(request?.id) && completed,
  });
  const manifest = manifestQuery.data ?? null;

  // El veredicto sale del verificador del servidor, que recalcula todo en cada consulta.
  const verification = useQuery({
    queryKey: ["evidence-verify", manifest?.manifestId],
    queryFn: () => verifyEvidenceManifest(manifest!.manifestId),
    enabled: Boolean(manifest),
    staleTime: 0,
  });

  const audit = useQuery({
    queryKey: ["audit", request?.id],
    queryFn: () => apiClient.get<AuditEvent[]>(`/process-audit?signatureRequestId=${encodeURIComponent(request!.id)}`),
    enabled: Boolean(request?.id),
  });

  const names = useMemo(() => {
    const map = new Map<string, string>();
    request?.signers.forEach((s) => s.name && map.set(s.signerId, s.name));
    return map;
  }, [request]);
  const nameOf = (actorId: string) => names.get(actorId) ?? actorId;

  const title = documentQuery.data?.filename ?? "Documento";
  const loading = requestsQuery.isLoading || (completed && manifestQuery.isLoading);
  const events = audit.data ?? [];

  return (
    <AppShell title={`Evidencia · ${title}`}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          back={{ href: `/documents/${documentId}`, label: "Volver al documento" }}
          title="Evidencia"
          description={
            <>
              Qué pasó con <span className="break-all font-medium text-foreground">{title}</span> y cómo comprobarlo sin
              confiar en Prestige.
            </>
          }
        />

        {loading ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]" aria-busy>
            <Skeleton className="h-96 rounded-lg" />
            <Skeleton className="h-96 rounded-lg" />
          </div>
        ) : requestsQuery.isError || manifestQuery.isError ? (
          <div role="alert" className="rounded-lg border border-border p-6 text-sm">
            No se pudo cargar la evidencia.{" "}
            <Button variant="link" onClick={() => (requestsQuery.isError ? requestsQuery.refetch() : manifestQuery.refetch())}>
              Reintentar
            </Button>
          </div>
        ) : !completed || !manifest ? (
          <div className="max-w-2xl space-y-5">
            <div role="status" className="flex items-start gap-4 rounded-lg border border-border bg-muted/40 p-5">
              <span aria-hidden className="flex shrink-0 items-center justify-center text-foreground">
                <Lock className="size-8" strokeWidth={1.5} />
              </span>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold leading-tight text-balance">
                  {request ? "Congelado, sin verificar todavía" : "Este documento aún no se envía a firma"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {request
                    ? "El expediente se sella cuando todos firman. Mientras tanto solo se afirma lo cierto: el documento está congelado y su huella no puede cambiar. La integridad completa se verifica al terminar las firmas."
                    : "Cuando se envíe a firma, el original se congela con su huella SHA-256."}
                </p>
                {documentQuery.data?.hash ? (
                  <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    SHA-256 del original
                    <HashChip value={documentQuery.data.hash} label="SHA-256 del original" />
                  </p>
                ) : null}
              </div>
            </div>
            <p className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Lo que este expediente no es. </span>
              {TRUST_NOTE}
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="min-w-0 space-y-8">
              <VerificationReport
                result={verification.data}
                checkedAt={verification.dataUpdatedAt ? new Date(verification.dataUpdatedAt) : undefined}
                between={
                  <div className="space-y-5">
                    <CustodyTimeline custody={manifest.chainOfCustody} nameOf={nameOf} />
                    <Button variant="outline" onClick={() => verification.refetch()} disabled={verification.isFetching}>
                      <RefreshCcw className={verification.isFetching ? "animate-spin" : undefined} />
                      {verification.isFetching ? "Verificando…" : "Verificar de nuevo"}
                    </Button>
                    {verification.isError ? (
                      <p role="alert" className="text-sm text-muted-foreground">
                        No se pudo consultar al verificador del servidor, así que no se afirma que el expediente sea
                        íntegro.
                      </p>
                    ) : null}
                  </div>
                }
                detail={{
                  documentHash: <HashChip value={manifest.originalHash} label="hash del documento" />,
                  packageHash: <HashChip value={manifest.packageHash} label="hash del paquete" />,
                  timestamp: (
                    <span className="text-sm text-muted-foreground">
                      {manifest.timestampProvider} · {when.format(new Date(manifest.timestampIssuedAt))}
                    </span>
                  ),
                }}
              />

              {events.length > 0 ? (
                <section aria-label="Bitácora del sobre">
                  <h2 className="text-lg font-semibold">Bitácora del sobre</h2>
                  <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
                    {events.map((e, i) => (
                      <li key={`${e.action}-${e.createdAt}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3 text-sm">
                        <span className="w-32 shrink-0 text-sm tabular-nums text-muted-foreground">{short.format(new Date(e.createdAt))}</span>
                        <span className="min-w-0 flex-1">{auditLabel(e.action)}</span>
                        <span className="truncate text-sm text-muted-foreground">{e.actorName?.trim() || nameOf(e.actorId)}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              {manifest.consentRecords.length > 0 ? (
                <section aria-label="Consentimientos">
                  <h2 className="text-lg font-semibold">Consentimientos de los firmantes</h2>
                  <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                    {manifest.consentRecords.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3 text-sm">
                        <span>
                          {nameOf(c.signerId)} · versión {c.textVersion}
                        </span>
                        <span className="text-sm tabular-nums text-muted-foreground">{short.format(new Date(c.acceptedAt))}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            <div className="lg:sticky lg:top-20 lg:self-start">
              <DossierCard manifestId={manifest.manifestId} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
