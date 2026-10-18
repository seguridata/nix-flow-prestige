"use client";

import { useRef, useState } from "react";
import { FileDown, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { lookupRowsCsv, type LookupTable } from "@/libs/lookup";
import { fetchAllLookupRows } from "@/services/lookup-tables-service";

const nf = new Intl.NumberFormat("es-MX");

/**
 * Exporta TODAS las filas a CSV. El BFF solo entrega 200 por página, así que se recorre por cursor en bucle
 * mostrando el avance; se puede cancelar entre páginas.
 */
export function ExportRowsButton({ table }: { table: LookupTable }) {
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = progress !== null;

  async function run() {
    const ctl = new AbortController();
    abort.current = ctl;
    setProgress({ loaded: 0, total: table.rowCount });
    try {
      const rows = await fetchAllLookupRows(table.id, { signal: ctl.signal, onProgress: setProgress });
      const blob = new Blob(["﻿" + lookupRowsCsv(table.columns, rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `filas-${table.key}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Se exportaron ${nf.format(rows.length)} ${rows.length === 1 ? "fila" : "filas"}.`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") toast.message("Exportación cancelada.");
      else toast.error(e instanceof Error && e.message ? `No se pudo exportar: ${e.message}` : "No se pudo exportar las filas.");
    } finally {
      abort.current = null;
      setProgress(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={running || table.rowCount === 0} onClick={() => void run()}>
        <FileDown /> Exportar CSV
      </Button>
      {running ? (
        <>
          <progress className="h-2 w-28" max={Math.max(progress.total, 1)} value={progress.loaded} aria-label="Avance de la exportación" />
          <Button variant="ghost" size="sm" onClick={() => abort.current?.abort()} aria-label="Cancelar la exportación">
            <X /> Cancelar
          </Button>
        </>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {running ? `Exportando… ${nf.format(progress.loaded)} de ${nf.format(progress.total)} filas` : ""}
      </span>
      {running ? (
        <span aria-hidden className="text-xs text-muted-foreground tabular-nums">
          {nf.format(progress.loaded)} de {nf.format(progress.total)}
        </span>
      ) : null}
    </div>
  );
}
