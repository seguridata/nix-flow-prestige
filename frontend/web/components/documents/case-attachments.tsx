"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, FileText, FileType2, ImageIcon, Paperclip } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/libs/attachments";
import { documentContentUrl } from "@/services/documents-service";
import { fetchCaseAttachments, type CaseAttachment } from "@/services/formats-service";

function iconFor(mime: string, name: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.includes("sheet") || mime.includes("excel") || /\.xlsx?$/i.test(name)) return FileSpreadsheet;
  if (mime.includes("word") || /\.docx?$/i.test(name)) return FileType2;
  return FileText;
}

/** «Cotizaciones_proveedor» → «Cotizaciones proveedor»: la clave es la del formato, no un texto pensado para leerse. */
const labelOf = (key: string) => key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/**
 * Anexos que viajaron con el formato (ADR-008). Los ve el dueño del expediente y quienes firman o reciben su
 * solicitud; para cualquier otra persona el BFF responde 404 y el bloque simplemente no aparece.
 */
export function CaseAttachments({ caseId }: { caseId: string | undefined }) {
  const query = useQuery({
    queryKey: ["case-attachments", caseId],
    queryFn: () => fetchCaseAttachments(caseId as string),
    enabled: Boolean(caseId),
    retry: false,
  });

  if (!caseId || query.isError) return null;
  if (query.isLoading) return <Skeleton className="h-28 w-full" />;
  const items = query.data ?? [];
  if (items.length === 0) return null;

  const groups = new Map<string, CaseAttachment[]>();
  for (const a of items) groups.set(a.attachmentKey, [...(groups.get(a.attachmentKey) ?? []), a]);

  return (
    <Card className="gap-0 p-0" data-testid="case-attachments">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Paperclip className="size-4 text-muted-foreground" strokeWidth={1.75} />
        <h2 className="text-sm font-semibold">Anexos del expediente</h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {items.length} {items.length === 1 ? "archivo" : "archivos"}
        </span>
      </div>
      <div className="divide-y divide-border">
        {[...groups.entries()].map(([key, files]) => (
          <section key={key} aria-label={labelOf(key)} className="px-4 py-3">
            <h3 className="mb-1 text-sm font-medium">{labelOf(key)}</h3>
            <ul>
              {files.map((f) => {
                const Icon = iconFor(f.mimeType, f.filename);
                return (
                  <li key={f.documentId} className="flex items-center gap-3 py-2">
                    <Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{f.filename}</p>
                      <p className="font-mono text-xs text-muted-foreground tabular-nums">
                        {formatBytes(f.sizeBytes)} · SHA-256 {f.hash.slice(0, 10)}…
                      </p>
                    </div>
                    <a
                      href={documentContentUrl(f.documentId)}
                      download={f.filename}
                      aria-label={`Descargar ${f.filename}`}
                      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Download className="size-4" />
                      Descargar
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}
