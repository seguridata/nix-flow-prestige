"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Lock, RefreshCcw } from "lucide-react";

import { DossierCard } from "@/components/evidence/dossier-card";
import { VerificationReport } from "@/components/evidence/verification-report";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { auditLabel, shortHash } from "@/libs/envelope-status";
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

function Hash({ value }: { value: string }) {
  return (
    <code className="inline-block rounded bg-muted px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground" title={value}>
      {shortHash(value, 8, 4)}
    </code>
  );
}

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
        <Link
          href={`/documents/${documentId}`}
          className="mb-4 inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden /> Volver al documento
        </Link>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Evidencia — {title}</h1>

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
          <div className="max-w-2xl rounded-lg border border-border p-6">
            <p className="flex items-start gap-2 text-base font-medium">
              <Lock className="mt-0.5 size-5 shrink-0" aria-hidden />
              {request ? "El expediente se sella cuando todos firman" : "Este documento aún no se envía a firma"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {request
                ? "Mientras tanto, solo se afirma lo cierto: el documento está congelado y su huella no puede cambiar. La integridad completa se verifica al terminar las firmas."
                : "Cuando se envíe a firma, el original se congela con su huella SHA-256."}
            </p>
            {documentQuery.data?.hash ? (
              <dl className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-4 text-sm">
                <dt className="text-muted-foreground">SHA-256 del original</dt>
                <dd>
                  <Hash value={documentQuery.data.hash} />
                </dd>
              </dl>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <div className="min-w-0 space-y-6">
              <VerificationReport
                result={verification.data}
                checkedAt={verification.dataUpdatedAt ? new Date(verification.dataUpdatedAt) : undefined}
                detail={{
                  documentHash: <Hash value={manifest.originalHash} />,
                  packageHash: <Hash value={manifest.packageHash} />,
                  timestamp: (
                    <span className="text-xs text-muted-foreground">
                      {manifest.timestampProvider} · {when.format(new Date(manifest.timestampIssuedAt))}
                    </span>
                  ),
                }}
              />
              {verification.isError ? (
                <p role="alert" className="text-sm text-muted-foreground">
                  No se pudo consultar al verificador del servidor, así que no se afirma que el expediente sea íntegro.
                </p>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => verification.refetch()} disabled={verification.isFetching}>
                <RefreshCcw className={verification.isFetching ? "animate-spin" : undefined} />
                {verification.isFetching ? "Verificando…" : "Verificar de nuevo"}
              </Button>

              {events.length > 0 ? (
                <section aria-label="Línea de eventos">
                  <h2 className="text-lg font-semibold">Línea de eventos</h2>
                  <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
                    {events.map((e, i) => (
                      <li key={`${e.action}-${e.createdAt}-${i}`} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                        <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{short.format(new Date(e.createdAt))}</span>
                        <span className="flex-1">{auditLabel(e.action)}</span>
                        <span className="truncate text-xs text-muted-foreground">{e.actorName?.trim() || nameOf(e.actorId)}</span>
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
                      <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5 text-sm">
                        <span>
                          {nameOf(c.signerId)} · versión {c.textVersion}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">{short.format(new Date(c.acceptedAt))}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            <div className="lg:sticky lg:top-6 lg:self-start">
              <DossierCard manifestId={manifest.manifestId} custody={manifest.chainOfCustody} nameOf={nameOf} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
