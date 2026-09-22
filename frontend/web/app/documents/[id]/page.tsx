"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CheckCircle2, Circle, Clock, FileText, PenTool, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/documents/status-badge";
import { PresenceIndicator } from "@/components/documents/presence-indicator";
import { CommentThread } from "@/components/documents/comment-thread";
import { SignMethodDialog } from "@/components/signature/sign-method-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useSession } from "@/store/session-store";
import { signerBlockedBy } from "@/libs/signing-turn";
import { useDocumentRealtime } from "@/hooks/use-document-realtime";
import { fetchDocument, documentContentUrl } from "@/services/documents-service";
import {
  cancelRequest,
  delegateRequest,
  fetchConsentText,
  fetchSignatureRequestsForDocument,
  fetchSigningCapabilities,
  signRequest,
} from "@/services/signature-requests-service";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiClient } from "@/services/api-client";
import type { SignatureMethod } from "@/libs/types";

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: documentId } = use(params);
  const { signerId } = useSession();
  const queryClient = useQueryClient();

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
  });

  const requestsQuery = useQuery({
    queryKey: ["signature-requests", "document", documentId],
    queryFn: () => fetchSignatureRequestsForDocument(documentId),
  });

  const { presentActors } = useDocumentRealtime(documentId);

  const request = requestsQuery.data?.[0];
  const me = request?.signers.find((s) => s.signerId === signerId);
  // Secuencial: firmante anterior aún pendiente que bloquea mi turno (o null).
  const blockedBy = request ? signerBlockedBy(request, signerId) : null;
  const canSignNow = me?.status === "PENDIENTE" && !blockedBy;

  // URL same-origin al PDF; el navegador la abre con su visor nativo.
  const pdfDataUrl = documentContentUrl(documentId);

  const [methodDialogOpen, setMethodDialogOpen] = useState(false);
  const [delegateTo, setDelegateTo] = useState("");
  const [delegateName, setDelegateName] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const consentQuery = useQuery({
    queryKey: ["consent-text"],
    queryFn: fetchConsentText,
  });
  const capsQuery = useQuery({
    queryKey: ["signing-capabilities"],
    queryFn: fetchSigningCapabilities,
  });

  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!request) throw new Error("No hay solicitud");
      return cancelRequest(request.id, signerId);
    },
    onSuccess: () => {
      toast.success("Solicitud cancelada.");
      queryClient.invalidateQueries({ queryKey: ["signature-requests", "document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["inbox", signerId] });
      queryClient.invalidateQueries({ queryKey: ["sent", signerId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar.");
    },
  });

  const signMutation = useMutation({
    mutationFn: (payload: {
      method: SignatureMethod;
      autograph?: Blob;
      consentAccepted: boolean;
    }) => {
      if (!request) throw new Error("No hay solicitud de firma para este documento");
      return signRequest(
        request.id,
        { method: payload.method, consentAccepted: payload.consentAccepted },
        payload.autograph,
      );
    },
    onSuccess: () => {
      toast.success("Documento firmado. El trazo queda dentro del recuadro verde.");
      setMethodDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["signature-requests", "document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["document-content", documentId] });
      queryClient.invalidateQueries({ queryKey: ["inbox", signerId] });
      queryClient.invalidateQueries({ queryKey: ["audit", request?.id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo firmar el documento.");
    },
  });

  const auditQuery = useQuery({
    queryKey: ["audit", request?.id],
    enabled: Boolean(request?.id),
    queryFn: () =>
      apiClient.get<{ action: string; actorId: string; createdAt: string }[]>(
        `/signature-requests/${request!.id}/audit`,
      ),
  });

  const delegateMutation = useMutation({
    mutationFn: () => {
      if (!request) throw new Error("No hay solicitud");
      return delegateRequest(request.id, {
        fromSignerId: signerId,
        toSignerId: delegateTo.trim(),
        toName: delegateName.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Firma delegada.");
      setDelegateTo("");
      setDelegateName("");
      queryClient.invalidateQueries({ queryKey: ["signature-requests", "document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["inbox", signerId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo delegar"),
  });

  function handleSignClick() {
    if (!request) return;
    setMethodDialogOpen(true);
  }

  return (
    <AppShell title={documentQuery.data?.filename ?? "Documento"}>
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Card className="flex h-[75vh] flex-col overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm text-muted-foreground">
              <FileText className="size-4" strokeWidth={1.75} />
              {documentQuery.data?.filename ?? "Cargando documento…"}
            </div>
            <div className="flex-1 bg-muted">
              {pdfDataUrl ? (
                <object
                  data={pdfDataUrl}
                  type="application/pdf"
                  className="h-full w-full"
                  aria-label="Vista previa del documento"
                >
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    Tu navegador no puede previsualizar este PDF. Descárgalo para revisarlo.
                  </div>
                </object>
              ) : (
                <div className="h-full animate-pulse bg-muted" />
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08 }}
        >
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Detalles del flujo</h2>
              {request ? <StatusBadge status={request.status} /> : null}
            </div>

            {request ? (
              <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                <Link href={`/documents/${documentId}/fields`}>
                  <PenTool className="size-4" strokeWidth={1.75} />
                  Colocar campos de firma
                </Link>
              </Button>
            ) : null}

            {request?.status === "COMPLETADA" ? (
              <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                <Link href={`/documents/${documentId}/evidence`}>
                  <ShieldCheck className="size-4" strokeWidth={1.75} />
                  Ver evidencia
                </Link>
              </Button>
            ) : null}

            <PresenceIndicator actors={presentActors} className="mt-3" />

            <Separator className="my-5" />

            {request ? (
              <p className="text-xs text-muted-foreground">
                {request.signers.filter((s) => s.status === "PENDIENTE").length === 0
                  ? "Todos firmaron."
                  : `Faltan: ${request.signers
                      .filter((s) => s.status === "PENDIENTE")
                      .map((s) => s.name ?? s.signerId)
                      .join(", ")}`}
              </p>
            ) : null}

            <div className="flex flex-col gap-4">
              {request?.signers.map((signer) => (
                <div key={signer.signerId} className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {signer.status === "FIRMADO" ? (
                      <CheckCircle2 className="size-5 text-success" strokeWidth={2} />
                    ) : signer.status === "RECHAZADO" ? (
                      <Circle className="size-5 text-destructive" strokeWidth={2} />
                    ) : (
                      <Clock className="size-5 text-muted-foreground" strokeWidth={2} />
                    )}
                  </div>
                  <div className="flex flex-1 items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {signer.name ?? signer.signerId}
                        {signer.signerId === signerId ? " (Tú)" : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {signer.role === "REVISOR" ? "Revisor" : "Firmante"}
                        {signer.delegatedToName || signer.delegatedTo
                          ? ` · delegado a ${signer.delegatedToName ?? signer.delegatedTo}`
                          : ""}
                        {signer.signedAt
                          ? ` · firmó ${new Date(signer.signedAt).toLocaleString("es-MX")}`
                          : ""}
                      </p>
                    </div>
                    <Avatar className="size-8">
                      <AvatarFallback>{initialsOf(signer.name ?? signer.signerId)}</AvatarFallback>
                    </Avatar>
                  </div>
                </div>
              ))}
            </div>

            {canSignNow ? (
              <Button
                className="mt-6 w-full"
                size="lg"
                onClick={handleSignClick}
                disabled={signMutation.isPending}
              >
                {signMutation.isPending ? "Firmando…" : "Firmar documento ahora"}
              </Button>
            ) : blockedBy ? (
              <p className="mt-6 text-center text-sm text-muted-foreground">
                Orden secuencial: te toca cuando firme{" "}
                <span className="font-medium text-foreground">
                  {blockedBy.name ?? blockedBy.signerId}
                </span>
                .
              </p>
            ) : me?.status === "FIRMADO" ? (
              <p className="mt-6 text-center text-sm text-success">
                Ya firmaste este documento
                {me.usedMethod ? ` · método: ${me.usedMethod.toLowerCase()}` : ""}.
              </p>
            ) : null}

            {me?.status === "PENDIENTE" ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Delegar</p>
                <Input
                  placeholder="ID del suplente"
                  value={delegateTo}
                  onChange={(e) => setDelegateTo(e.target.value)}
                />
                <Input
                  placeholder="Nombre del suplente"
                  value={delegateName}
                  onChange={(e) => setDelegateName(e.target.value)}
                />
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!delegateTo.trim() || delegateMutation.isPending}
                  onClick={() => delegateMutation.mutate()}
                >
                  {delegateMutation.isPending ? "Delegando…" : "Delegar firma"}
                </Button>
              </div>
            ) : null}

            {request && (request.status === "PENDIENTE" || request.status === "EN_FIRMA") ? (
              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={() => setConfirmCancel(true)}
                disabled={cancelMutation.isPending}
              >
                Cancelar solicitud
              </Button>
            ) : null}

            {(auditQuery.data ?? []).length > 0 ? (
              <div className="mt-6">
                <h3 className="text-sm font-semibold">Bitácora del proceso</h3>
                <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  {auditQuery.data?.map((event, i) => (
                    <li key={`${event.action}-${i}`}>
                      <span className="font-medium text-foreground">{event.action}</span>
                      {" · "}
                      {new Date(event.createdAt).toLocaleString("es-MX")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <CommentThread documentId={documentId} />
          </Card>
        </motion.div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancelar solicitud"
        description="El flujo se detiene y los firmantes pendientes dejan de verla en bandeja."
        confirmLabel="Cancelar solicitud"
        destructive
        pending={cancelMutation.isPending}
        onConfirm={() => {
          cancelMutation.mutate();
          setConfirmCancel(false);
        }}
      />
      {request ? (
        <SignMethodDialog
          open={methodDialogOpen}
          onOpenChange={setMethodDialogOpen}
          allowedMethods={request.methods}
          consentText={consentQuery.data}
          biometricReady={capsQuery.data?.find((c) => c.method === "BIOMETRICA")?.configured}
          isSubmitting={signMutation.isPending}
          onConfirm={(payload) => signMutation.mutate(payload)}
        />
      ) : null}
    </AppShell>
  );
}
