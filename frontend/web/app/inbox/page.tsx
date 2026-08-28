"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "motion/react";
import { FileText, FlaskConical, Plus } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/documents/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useSession } from "@/store/session-store";
import { fetchInbox } from "@/services/inbox-service";
import { createSelfSignDemo } from "@/services/signature-requests-service";

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function InboxPage() {
  const { signerId, name, email } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const demoMutation = useMutation({
    mutationFn: () => createSelfSignDemo({ signerId, name, email }),
    onSuccess: (result) => {
      toast.success("Prueba lista para firmar.");
      queryClient.invalidateQueries({ queryKey: ["inbox", signerId] });
      router.push(`/documents/${result.document.id}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la prueba.");
    },
  });
  const { data: items, isLoading } = useQuery({
    queryKey: ["inbox", signerId],
    queryFn: () => fetchInbox(signerId),
  });
  const pendingCount = items?.filter((item) => item.myStatus === "PENDIENTE").length ?? 0;
  const firstName = name.split(" ")[0];

  return (
    <AppShell
      title="Bandeja"
      actions={
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => demoMutation.mutate()}
            disabled={demoMutation.isPending}
          >
            <FlaskConical className="size-4" />
            {demoMutation.isPending ? "Generando…" : "Prueba para firmar"}
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/new">
              <Plus className="size-4" /> Nuevo envío
            </Link>
          </Button>
        </div>
      }
    >
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.215, 0.61, 0.355, 1] }}
          className="mb-10"
        >
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Bandeja de firma</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Hola, {firstName}.{" "}
            {pendingCount > 0 ? (
              <>
                Tienes <span className="text-primary">{pendingCount}</span> por firmar.
              </>
            ) : (
              "Nada pendiente."
            )}
          </h1>
        </motion.div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-lg border border-border bg-muted/60" />
            ))}
          </div>
        ) : items && items.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {items.map((item, index) => (
              <motion.div
                key={item.signatureRequestId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: index * 0.05, ease: [0.215, 0.61, 0.355, 1] }}
              >
                <Card className="glass h-full p-6 transition-transform duration-150 hover:-translate-y-0.5">
                  <div className="flex items-start justify-between">
                    <div className="flex size-11 items-center justify-center rounded-md bg-muted">
                      <FileText className="size-5" strokeWidth={1.75} />
                    </div>
                    <StatusBadge status={item.myStatus} />
                  </div>
                  <h2 className="mt-5 text-lg font-semibold">{item.caseTitle || item.documentTitle}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{item.documentTitle}</p>
                  <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
                    <Avatar className="size-6">
                      <AvatarFallback className="text-[10px]">{initialsOf(item.requestedByName)}</AvatarFallback>
                    </Avatar>
                    {item.requestedByName}
                  </div>
                  <div className="mt-6 flex gap-2">
                    <Button asChild className="flex-1">
                      <Link href={`/documents/${item.documentId}`}>
                        {item.myStatus === "PENDIENTE" ? "Revisar y firmar" : "Ver expediente"}
                      </Link>
                    </Button>
                    <Sheet>
                      <SheetTrigger className="inline-flex h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-muted">
                        Vista
                      </SheetTrigger>
                      <SheetContent title={item.documentTitle} className="p-6">
                        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Inspección</p>
                        <h2 className="mt-2 text-xl font-semibold">{item.caseTitle || item.documentTitle}</h2>
                        <p className="mt-2 text-sm text-muted-foreground">{item.documentTitle}</p>
                        <p className="mt-4 text-sm">De {item.requestedByName}</p>
                        <p className="text-xs text-muted-foreground">Estado {item.myStatus}</p>
                        <Button asChild className="mt-6 w-full">
                          <Link href={`/documents/${item.documentId}`}>Abrir expediente</Link>
                        </Button>
                      </SheetContent>
                    </Sheet>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        ) : (
          <Card className="glass overflow-hidden p-0">
            <img src="/brand/empty-inbox.jpg" alt="" className="h-48 w-full object-cover" />
            <div className="px-6 py-8 text-center">
              <p className="text-base font-medium">No hay documentos por firmar</p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                Cuando alguien te envíe un contrato, aparecerá aquí. También puedes generar una prueba para firmarte a ti mismo.
              </p>
              <Button className="mt-4" onClick={() => demoMutation.mutate()} disabled={demoMutation.isPending}>
                Generar prueba para firmar
              </Button>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
