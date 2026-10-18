"use client";

import { useId, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, Download, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { lookupCsvTemplate, parseLookupImport, type LookupTable } from "@/libs/lookup";
import { importLookupRows } from "@/services/lookup-tables-service";

const DELIMITER_NAME = { ",": "coma", ";": "punto y coma", "\t": "tabulador (Excel)" } as const;

export function downloadTemplate(table: LookupTable) {
  const blob = new Blob(["﻿" + lookupCsvTemplate(table.columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plantilla-${table.key}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Importa filas desde un CSV o pegando celdas de Excel. Se valida TODO antes de enviar y los errores
 * se listan por línea; el servidor aplica todo o nada.
 */
export function ImportDialog({ table, onClose, onDone }: { table: LookupTable; onClose: () => void; onDone: () => void }) {
  const uid = useId();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [replace, setReplace] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const result = useMemo(() => (text.trim() ? parseLookupImport(text, table.columns) : null), [text, table.columns]);
  const ok = result !== null && result.errors.length === 0 && result.rows.length > 0;
  const shownErrors = result?.errors.slice(0, 50) ?? [];

  const send = useMutation({
    mutationFn: () => importLookupRows(table.id, result!.rows, replace),
    onSuccess: () => {
      toast.success(`Se importaron ${result!.rows.length} filas${replace ? " y se reemplazaron las anteriores" : ""}.`);
      onDone();
    },
    onError: (e: Error) => {
      setConfirming(false);
      toast.error(e.message || "No se pudo importar. No se cambió nada.");
    },
  });

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    setText(await f.text());
  }

  return (
    <>
      <Dialog open={!confirming} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar filas a «{table.name}»</DialogTitle>
            <DialogDescription>
              Sube un CSV o pega las celdas copiadas de Excel. La primera fila es la cabecera con los nombres de las columnas. Se acepta coma,
              punto y coma o tabulador, comillas y BOM. Se valida todo antes de enviar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => downloadTemplate(table)}>
                <Download /> Descargar plantilla CSV
              </Button>
              <span className="text-xs text-muted-foreground">
                Columnas: <span className="font-mono">{table.columns.map((c) => c.key).join(", ")}</span>
              </span>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${uid}-file`} className="text-sm font-medium">
                Archivo CSV
              </label>
              <input
                id={`${uid}-file`}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                onChange={(e) => void onFile(e.target.files?.[0])}
                className="block w-full text-sm file:mr-3 file:h-10 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-3 file:text-sm file:font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${uid}-text`} className="text-sm font-medium">
                …o pega aquí desde Excel {fileName ? <span className="font-normal text-muted-foreground">(contenido de {fileName})</span> : null}
              </label>
              <textarea
                id={`${uid}-text`}
                rows={6}
                spellCheck={false}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setFileName("");
                }}
                placeholder={`${table.columns.map((c) => c.label).join("\t")}\n…`}
                className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>

            {result ? (
              ok ? (
                <div role="status" className="space-y-1 rounded-md bg-[#eaf3d6] p-3 text-sm text-[#3f5900]">
                  <p className="flex items-start gap-2">
                    <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {result.rows.length} {result.rows.length === 1 ? "fila válida" : "filas válidas"}, listas para importar (separador: {DELIMITER_NAME[result.delimiter]}).
                  </p>
                  {result.missingColumns.length > 0 ? (
                    <p className="pl-6">
                      El archivo no trae {result.missingColumns.map((c) => `«${c}»`).join(", ")}: esas celdas quedarán vacías («cualquiera»).
                    </p>
                  ) : null}
                </div>
              ) : (
                <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-[#fbe9e7] p-3 text-sm text-[#8c2018]">
                  <p className="flex items-start gap-2 font-medium">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {result.errors.length} {result.errors.length === 1 ? "error" : "errores"}. No se envió nada; corrige el texto o el archivo y vuelve a intentar.
                  </p>
                  <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-9">
                    {shownErrors.map((e, i) => (
                      <li key={i}>
                        {e.line > 0 ? `Línea ${e.line}: ` : ""}
                        {e.message}
                      </li>
                    ))}
                  </ul>
                  {result.errors.length > shownErrors.length ? <p className="pl-6">…y {result.errors.length - shownErrors.length} más.</p> : null}
                </div>
              )
            ) : null}

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[#84bd00]" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              <span>
                Reemplazar las existentes
                <span className="block text-xs text-muted-foreground">
                  {replace
                    ? `Se borrarán las ${table.rowCount} filas actuales y quedarán solo las del texto.`
                    : "Si no la marcas, las filas nuevas se agregan al final, después de las que ya existen."}
                </span>
              </span>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" disabled={!ok || send.isPending} onClick={() => (replace ? setConfirming(true) : send.mutate())}>
              {send.isPending ? "Importando…" : replace ? "Reemplazar e importar…" : "Importar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="¿Reemplazar todas las filas?"
        description={`Se borrarán las ${table.rowCount} filas actuales y se cargarán ${result?.rows.length ?? 0}. Esta acción no se puede deshacer.`}
        confirmLabel={`Sí, borrar ${table.rowCount} e importar`}
        destructive
        pending={send.isPending}
        onConfirm={() => send.mutate()}
      />
    </>
  );
}
