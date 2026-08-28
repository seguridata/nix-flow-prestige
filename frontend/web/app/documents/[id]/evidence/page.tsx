"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  ArrowLeft,
  CheckCircle2,
  Fingerprint,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { fetchDocument } from "@/services/documents-service";
import { fetchSignatureRequestsForDocument } from "@/services/signature-requests-service";
import {
  fetchEvidenceForRequest,
  verifyEvidenceManifest,
} from "@/services/evidence-service";
import type { EvidenceVerificationResult } from "@/libs/types";

const ACTION_LABELS: Record<string, string> = {
  SIGNATURE_REQUEST_CREATED: "Solicitud de firma creada",
  CONSENT_RECORDED: "Consentimiento registrado",
  SIGNATURE_APPLIED: "Firma aplicada",
  TIMESTAMP_ISSUED: "Sello de tiempo emitido",
};

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

function truncateHash(hash: string) {
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function HashChip({ value }: { value: string }) {
  return (
    <span
      title={value}
      className="inline-block rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px] tracking-tight text-muted-foreground"
    >
      {truncateHash(value)}
    </span>
  );
}

export default function EvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: documentId } = use(params);

  const [liveResult, setLiveResult] = useState<EvidenceVerificationResult | null>(null);

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
  });

  const requestsQuery = useQuery({
    queryKey: ["signature-requests", "document", documentId],
    queryFn: () => fetchSignatureRequestsForDocument(documentId),
  });

  const request = requestsQuery.data?.[0];
  const requestCompleted = request?.status === "COMPLETADA";

  const manifestQuery = useQuery({
    queryKey: ["evidence", "by-request", request?.id],
    queryFn: () => fetchEvidenceForRequest(request!.id),
    enabled: Boolean(request?.id) && requestCompleted,
  });

  const manifest = manifestQuery.data ?? null;

  const signerNameById = useMemo(() => {
    const map = new Map<string, string>();
    request?.signers.forEach((s) => {
      if (s.name) map.set(s.signerId, s.name);
    });
    return map;
  }, [request]);

  const verifyMutation = useMutation({
    mutationFn: () => verifyEvidenceManifest(manifest!.manifestId),
    onSuccess: (result) => setLiveResult(result),
  });

  const isValid = liveResult ? liveResult.valid : manifest?.validationConclusion === "VALID";
  const isLoading = requestsQuery.isLoading || (requestCompleted && manifestQuery.isLoading);

  return (
    <AppShell title={`Evidencia · ${documentQuery.data?.filename ?? "Documento"}`}>
      <div className="mx-auto max-w-3xl">
        <img src="/brand/evidence-seal.jpg" alt="" className="mb-6 size-16 rounded-md object-cover" />
        <Link
          href={`/documents/${documentId}`}
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          Volver al documento
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Verificar autenticidad
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Este expediente conserva un manifiesto de evidencia con la cadena de
            custodia y los hashes criptográficos de cada paso del proceso de
            firma, para que puedas comprobar su integridad en cualquier momento.
          </p>
        </motion.div>

        <div className="mt-8 flex flex-col gap-6">
          {isLoading ? (
            <Card className="h-40 animate-pulse p-6" />
          ) : !requestCompleted || !manifest ? (
            <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <ShieldQuestion className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-base font-medium text-foreground">
                Todavía no hay evidencia disponible
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                El manifiesto de evidencia se genera automáticamente en cuanto
                todos los firmantes completan el documento. Vuelve a esta
                página cuando el proceso de firma haya terminado.
              </p>
            </Card>
          ) : (
            <>
              {/* Trust badge */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.05 }}
              >
                <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
                        isValid ? "bg-accent text-primary" : "bg-[#fbe9e7] text-destructive"
                      }`}
                    >
                      {isValid ? (
                        <ShieldCheck className="size-5" strokeWidth={2} />
                      ) : (
                        <ShieldAlert className="size-5" strokeWidth={2} />
                      )}
                    </div>
                    <div>
                      <p className="text-base font-semibold text-foreground">
                        {isValid ? "Documento verificado" : "Se detectaron inconsistencias"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Manifiesto <span className="font-mono">{manifest.manifestId}</span>
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => verifyMutation.mutate()}
                    disabled={verifyMutation.isPending}
                  >
                    <RefreshCcw
                      className={`size-4 ${verifyMutation.isPending ? "animate-spin" : ""}`}
                      strokeWidth={1.75}
                    />
                    {verifyMutation.isPending ? "Verificando…" : "Verificar de nuevo"}
                  </Button>
                </Card>
              </motion.div>

              {liveResult && !liveResult.valid ? (
                <Card className="border-destructive/30 bg-[#fbe9e7]/40 p-5">
                  <p className="text-sm font-medium text-destructive">
                    La verificación en vivo encontró diferencias:
                  </p>
                  <ul className="mt-2 list-inside list-disc text-sm text-destructive/90">
                    {liveResult.mismatches.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Card>
              ) : liveResult && liveResult.valid ? (
                <p className="-mt-2 flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="size-4" strokeWidth={2} />
                  Recalculado en vivo — todos los hashes coinciden.
                </p>
              ) : null}

              {/* Hashes técnicos */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.1 }}
              >
                <Card className="p-6">
                  <h2 className="text-base font-semibold text-foreground">
                    Huellas criptográficas
                  </h2>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Hash original</p>
                      <div className="mt-1">
                        <HashChip value={manifest.originalHash} />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Hash presentado</p>
                      <div className="mt-1">
                        <HashChip value={manifest.presentedHash} />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Hash de firmas</p>
                      <div className="mt-1">
                        <HashChip value={manifest.signedHash} />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Hash de paquete</p>
                      <div className="mt-1">
                        <HashChip value={manifest.packageHash} />
                      </div>
                    </div>
                  </div>
                  <Separator className="my-4" />
                  <p className="text-xs text-muted-foreground">
                    Sello de tiempo emitido por{" "}
                    <span className="font-medium text-foreground">
                      {manifest.timestampProvider}
                    </span>{" "}
                    el{" "}
                    {new Date(manifest.timestampIssuedAt).toLocaleString("es-MX")}
                  </p>
                </Card>
              </motion.div>

              {/* Chain of custody timeline */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.15 }}
              >
                <Card className="p-6">
                  <h2 className="text-base font-semibold text-foreground">
                    Cadena de custodia
                  </h2>
                  <div className="mt-5 flex flex-col">
                    {manifest.chainOfCustody.map((event, index) => (
                      <div key={`${event.action}-${event.at}-${index}`} className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="mt-1 flex size-2.5 shrink-0 items-center justify-center rounded-full bg-primary" />
                          {index < manifest.chainOfCustody.length - 1 ? (
                            <div className="w-px flex-1 bg-border" />
                          ) : null}
                        </div>
                        <div className="pb-6">
                          <p className="text-sm font-medium text-foreground">
                            {actionLabel(event.action)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {signerNameById.get(event.actorId) ?? event.actorId} ·{" "}
                            {new Date(event.at).toLocaleString("es-MX")}
                          </p>
                          <div className="mt-1.5">
                            <HashChip value={event.hashAfter} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </motion.div>

              {manifest.consentRecords.length > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.2 }}
                >
                  <Card className="p-6">
                    <div className="flex items-center gap-2">
                      <Fingerprint className="size-4 text-muted-foreground" strokeWidth={1.75} />
                      <h2 className="text-base font-semibold text-foreground">
                        Registros de consentimiento
                      </h2>
                    </div>
                    <div className="mt-4 flex flex-col gap-3">
                      {manifest.consentRecords.map((record) => (
                        <div
                          key={record.id}
                          className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="text-foreground">
                            {signerNameById.get(record.signerId) ?? record.signerId} · versión{" "}
                            {record.textVersion}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(record.acceptedAt).toLocaleString("es-MX")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </motion.div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
