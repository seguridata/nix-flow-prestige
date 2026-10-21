"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, Paperclip } from "lucide-react";

import { formatBytes } from "@/libs/attachments";
import { cn } from "@/libs/utils";
import { documentContentUrl } from "@/services/documents-service";
import { fetchCaseAttachments } from "@/services/formats-service";

interface ViewerItem {
  id: string;
  tab: string;
  filename: string;
  mime: string;
  size?: number;
}

const labelOf = (key: string) => key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const previewable = (mime: string) => mime === "application/pdf" || mime.startsWith("image/");

/**
 * Visor de la solicitud y de sus adjuntos: una pestaña por archivo, vista previa en el mismo panel y
 * «Guardar en mis archivos» (descarga con el nombre original). Los adjuntos solo los ve quien el BFF autoriza
 * (dueño, firmantes y destinatarios); para cualquier otra persona la lista viene vacía y queda solo la solicitud.
 */
export function DocumentViewer({
  documentId,
  caseId,
  filename,
  className,
}: {
  documentId: string;
  caseId: string | undefined;
  filename: string;
  className?: string;
}) {
  const attachments = useQuery({
    queryKey: ["case-attachments", caseId],
    queryFn: () => fetchCaseAttachments(caseId as string),
    enabled: Boolean(caseId),
    retry: false,
  });
  const items: ViewerItem[] = [
    { id: documentId, tab: "Solicitud", filename, mime: "application/pdf" },
    ...(attachments.data ?? []).map((a) => ({
      id: a.documentId,
      tab: `${labelOf(a.attachmentKey)}: ${a.filename}`,
      filename: a.filename,
      mime: a.mimeType,
      size: a.sizeBytes,
    })),
  ];
  const [selected, setSelected] = useState(documentId);
  const current = items.find((i) => i.id === selected) ?? items[0]!;
  const src = documentContentUrl(current.id);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {items.length > 1 ? (
        <div role="tablist" aria-label="Solicitud y adjuntos" className="flex gap-1 overflow-x-auto border-b border-border bg-muted p-1.5 [scrollbar-width:thin]">
          {items.map((it, i) => {
            const on = it.id === current.id;
            return (
              <button
                key={it.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setSelected(it.id)}
                className={cn(
                  "flex min-h-11 max-w-64 shrink-0 items-center gap-2 rounded-md px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "bg-background font-semibold text-foreground shadow-subtle" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                {i === 0 ? <FileText aria-hidden className="size-4 shrink-0" /> : <Paperclip aria-hidden className="size-4 shrink-0" />}
                <span className="truncate">{it.tab}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-2">
        <p className="min-w-0 truncate text-sm">
          <span className="font-medium">{current.filename}</span>
          {current.size ? <span className="ml-2 text-muted-foreground">{formatBytes(current.size)}</span> : null}
        </p>
        <div className="flex items-center gap-1">
          <a
            href={src}
            download={current.filename}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download aria-hidden className="size-4" />
            Guardar en mis archivos
          </a>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            aria-label={`Abrir ${current.filename} en otra pestaña`}
            className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink aria-hidden className="size-4" />
          </a>
        </div>
      </div>

      <div className="min-h-[50vh] flex-1 bg-muted/40">
        {previewable(current.mime) ? (
          <object key={current.id} data={src} type={current.mime} aria-label={current.filename} className="h-full min-h-[60vh] w-full">
            <div className="p-6 text-sm">
              <a href={src} target="_blank" rel="noreferrer" className="underline">
                Abrir el archivo
              </a>
            </div>
          </object>
        ) : (
          <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <FileText aria-hidden className="size-10" strokeWidth={1.5} />
            <p>Este tipo de archivo no tiene vista previa. Guárdalo en tus archivos para abrirlo.</p>
          </div>
        )}
      </div>
    </div>
  );
}
