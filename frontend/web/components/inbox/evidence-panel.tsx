"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { auditLabel, shortHash, statusSentence, type EnvelopeRow } from "@/libs/envelope-status";
import { apiClient } from "@/services/api-client";
import { fetchDocument } from "@/services/documents-service";
import { fetchEvidenceForRequest, verifyEvidenceManifest } from "@/services/evidence-service";

interface AuditEvent {
  action: string;
  actorId: string;
  createdAt: string;
}

const time = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Evidencia del sobre seleccionado. Lo verificable se muestra como tal: el sello de "Íntegro" sale
 * del verificador del BFF (no de un candado decorativo) y solo existe cuando el expediente ya se cerró.
 */
export function EvidencePanel({ row }: { row: EnvelopeRow }) {
  const doc = useQuery({ queryKey: ["document", row.documentId], queryFn: () => fetchDocument(row.documentId) });
  const audit = useQuery({
    queryKey: ["audit", row.signatureRequestId],
    queryFn: () =>
      apiClient.get<AuditEvent[]>(`/process-audit?signatureRequestId=${encodeURIComponent(row.signatureRequestId)}`),
  });
  const closed = row.status === "COMPLETADA";
  const verification = useQuery({
    queryKey: ["evidence-verify", row.signatureRequestId],
    enabled: closed,
    queryFn: async () => {
      const manifest = await fetchEvidenceForRequest(row.signatureRequestId);
      return manifest ? await verifyEvidenceManifest(manifest.id) : null;
    },
  });

  const events = audit.data ?? [];

  return (
    <section aria-label="Evidencia del sobre" className="flex flex-col gap-6">
      <header>
        <h2 className="text-xl font-semibold leading-tight text-balance">{row.caseTitle || row.documentTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{statusSentence(row)}</p>
      </header>

      <div className="rounded-lg border border-border bg-background p-4">
        {closed ? (
          verification.isLoading ? (
            <p className="text-sm text-muted-foreground">Verificando el expediente…</p>
          ) : verification.data?.valid ? (
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-5 text-foreground" aria-hidden /> Íntegro
              <span className="font-normal text-muted-foreground">· el verificador del servidor lo confirmó</span>
            </p>
          ) : verification.data ? (
            <p className="flex items-start gap-2 text-sm font-medium">
              <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
              <span>
                No se pudo confirmar la integridad
                <span className="block font-normal text-muted-foreground">
                  {verification.data.mismatches.join(", ") || "Revisa el expediente completo."}
                </span>
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Este sobre aún no tiene expediente sellado.</p>
          )
        ) : (
          <p className="flex items-start gap-2 text-sm">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              El documento está congelado.
              <span className="block text-muted-foreground">La integridad se verifica al completarse las firmas.</span>
            </span>
          </p>
        )}
        {doc.data?.hash ? (
          <dl className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
            <dt className="text-muted-foreground">SHA-256 del original</dt>
            <dd>
              <code className="rounded bg-muted px-2 py-1 font-mono tabular-nums" title={doc.data.hash}>
                {shortHash(doc.data.hash)}
              </code>
            </dd>
          </dl>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Línea de evidencia</h3>
        {audit.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Cargando eventos…</p>
        ) : events.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Todavía no hay eventos registrados para este sobre.</p>
        ) : (
          <ol className="mt-3 space-y-0">
            {events.map((e, i) => (
              <li key={`${e.action}-${e.createdAt}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
                {i < events.length - 1 ? (
                  <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-border" />
                ) : null}
                <span aria-hidden className="relative z-10 mt-1.5 size-[11px] shrink-0 rounded-full border border-foreground bg-background" />
                <div className="min-w-0">
                  <p className="text-sm">{auditLabel(e.action)}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{time.format(new Date(e.createdAt))}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Button asChild variant="secondary">
        <Link href={`/documents/${row.documentId}`}>Abrir expediente completo</Link>
      </Button>
    </section>
  );
}
