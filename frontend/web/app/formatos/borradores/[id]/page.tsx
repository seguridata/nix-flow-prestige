"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { FormatEditor } from "@/components/formats/format-editor";
import { AiDraftLabel } from "@/components/chat/chat-panel";
import { fetchTemplateDrafts } from "@/components/chat/template-drafts";
import { Button } from "@/components/ui/button";
import { useSession } from "@/store/session-store";

export default function ReviewTemplateDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { roles } = useSession();
  const isAdmin = roles.includes("admin");
  const drafts = useQuery({ queryKey: ["chat-template-drafts"], queryFn: fetchTemplateDrafts, enabled: isAdmin });
  const proposal = drafts.data?.find((draft) => draft.id === id);
  return (
    <AppShell title="Revisar borrador del asistente">
      <PageHeader back={{ href: "/formatos", label: "Todos los formatos" }} title="Revisar borrador del asistente" />
      {!isAdmin ? <p>Solo el administrador puede crear formatos.</p> : drafts.isPending ? <p role="status">Cargando borrador…</p> : drafts.isError ? (
        <div role="alert">No se pudo cargar el borrador. <Button onClick={() => drafts.refetch()}>Reintentar</Button></div>
      ) : !proposal ? <p role="alert">Este borrador ya no está disponible o no pertenece a tu cuenta.</p> : (
        <><div className="mb-6 space-y-2"><AiDraftLabel /><p className="text-sm text-muted-foreground">Revisa y ajusta los datos, participantes y condiciones. Guardar crea un formato digital sin publicar.</p></div><FormatEditor key={proposal.id} mode="FORM" proposal={proposal} /></>
      )}
    </AppShell>
  );
}
