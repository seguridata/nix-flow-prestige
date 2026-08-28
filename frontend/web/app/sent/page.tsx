"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CheckCircle2, Clock, FilePlus2, FlaskConical } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/documents/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSession } from "@/store/session-store";
import { fetchSent } from "@/services/inbox-service";
import { cancelRequest, createSelfSignDemo } from "@/services/signature-requests-service";

export default function SentPage() {
  const { signerId, name, email } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: items, isLoading } = useQuery({
    queryKey: ["sent", signerId],
    queryFn: () => fetchSent(signerId),
  });

  const demoMutation = useMutation({
    mutationFn: () => createSelfSignDemo({ signerId, name, email }),
    onSuccess: (result) => {
      toast.success("Prueba lista. Ábrela y firma con el lienzo autógrafo.");
      queryClient.invalidateQueries({ queryKey: ["sent", signerId] });
      queryClient.invalidateQueries({ queryKey: ["inbox", signerId] });
      router.push(`/documents/${result.document.id}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la prueba.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (requestId: string) => cancelRequest(requestId, signerId),
    onSuccess: () => {
      toast.success("Solicitud cancelada.");
      queryClient.invalidateQueries({ queryKey: ["sent", signerId] });
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
          <Button
            variant="outline"
            onClick={() => demoMutation.mutate()}
            disabled={demoMutation.isPending}
          >
            <FlaskConical className="size-4" />
            {demoMutation.isPending ? "Generando…" : "Generar prueba para firmar"}
          </Button>
        </div>

        {isLoading ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : items && items.length > 0 ? (
          <div className="flex flex-col gap-4">
            {items.map((item, index) => {
              const canCancel = item.status === "PENDIENTE" || item.status === "EN_FIRMA";
              return (
                <motion.div
                  key={item.signatureRequestId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.2 }}
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
            <p className="font-medium">Todavía no enviaste documentos</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Crea un envío o genera una prueba para firmar tú mismo.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Button asChild>
                <Link href="/new">Nuevo envío</Link>
              </Button>
              <Button variant="outline" onClick={() => demoMutation.mutate()} disabled={demoMutation.isPending}>
                Generar prueba
              </Button>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
