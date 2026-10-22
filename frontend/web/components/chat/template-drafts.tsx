"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/services/api-client";
import type { Flow } from "@/libs/flow";
import { Button } from "@/components/ui/button";

export interface TemplateDraft {
  id: string;
  name: string;
  description: string | null;
  flow: Flow;
  createdAt: string;
}

export const fetchTemplateDrafts = () => apiClient.get<TemplateDraft[]>("/chat/drafts/templates");

export function TemplateDrafts({ compact = false, hideWhenEmpty = false }: { compact?: boolean; hideWhenEmpty?: boolean }) {
  const drafts = useQuery({ queryKey: ["chat-template-drafts"], queryFn: fetchTemplateDrafts });
  // En el catálogo no hace falta un recuadro que diga que no hay nada: aparece solo cuando hay borradores.
  if (hideWhenEmpty && !drafts.isPending && !drafts.isError && !drafts.data?.length) return null;
  return (
    <section aria-label="Borradores de formato del asistente" className="mb-6 space-y-2 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold">Mis borradores del asistente</h2>
      <p className="text-xs text-muted-foreground">Revisa los datos y el flujo antes de guardar un formato digital. Los borradores del asistente caducan a los 30 días.</p>
      {drafts.isPending ? <p role="status" className="text-sm">Cargando borradores…</p> : drafts.isError ? (
        <div role="alert" className="text-sm">No se pudieron cargar los borradores. <Button variant="link" onClick={() => drafts.refetch()}>Reintentar</Button></div>
      ) : !drafts.data?.length ? <p className="text-sm text-muted-foreground">Todavía no has guardado borradores de formato.</p> : (
        <ul className="space-y-2">
          {drafts.data.map((draft) => (
            <li key={draft.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
              <div><p className="text-sm font-medium">{draft.name}</p>{!compact && draft.description ? <p className="text-xs text-muted-foreground">{draft.description}</p> : null}</div>
              <Button asChild size="sm" variant="outline"><Link href={`/formatos/borradores/${encodeURIComponent(draft.id)}` as never}>Revisar formato</Link></Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
