"use client";

import { useDeferredValue, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Search, X } from "lucide-react";
import { toast } from "sonner";

import { CaseIcon, DocumentIcon } from "@/components/drive/drive-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { caseTitleFromFilename, formatBytes, plural } from "@/libs/drive";
import { cn } from "@/libs/utils";
import { createCase } from "@/services/cases-service";
import { createDocument } from "@/services/documents-service";
import { searchMyCases } from "@/services/drive-service";

type Mode = "new" | "existing" | "loose";

const MODES: { id: Mode; title: string; hint: string }[] = [
  { id: "new", title: "Crear un expediente nuevo", hint: "Reúne este documento con los que vengan después." },
  { id: "existing", title: "Usar un expediente existente", hint: "Se agrega junto a los documentos que ya tiene." },
  { id: "loose", title: "Dejarlo suelto", hint: "Un documento solo, sin expediente." },
];

/**
 * Subida de documentos a "Mis documentos". Pregunta siempre dónde va el documento: expediente nuevo,
 * uno existente o suelto. Si se abre dentro de un expediente (`fixedCase`) la pregunta ya está
 * respondida y solo se suben los archivos.
 */
export function UploadDialog({
  open,
  onOpenChange,
  folderId,
  initialFiles,
  fixedCase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
  initialFiles: File[];
  fixedCase?: { id: string; title: string } | null;
}) {
  // El estado se reinicia con `key` desde el padre cada vez que se abre.
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [mode, setMode] = useState<Mode>(fixedCase ? "existing" : "new");
  const [title, setTitle] = useState(initialFiles[0] ? caseTitleFromFilename(initialFiles[0].name) : "");
  const [titleTouched, setTitleTouched] = useState(false);
  const [query, setQuery] = useState("");
  const [pickedCase, setPickedCase] = useState<string | null>(fixedCase?.id ?? null);
  const deferredQuery = useDeferredValue(query);

  const cases = useQuery({
    queryKey: ["my-cases", deferredQuery],
    queryFn: () => searchMyCases(deferredQuery),
    enabled: open && mode === "existing" && !fixedCase,
  });

  function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? []).filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (list && picked.length < list.length) toast.error("Por ahora solo se aceptan archivos PDF.");
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked]);
    if (!titleTouched && files.length === 0 && picked[0]) setTitle(caseTitleFromFilename(picked[0].name));
  }

  const upload = useMutation({
    mutationFn: async () => {
      if (mode === "new") {
        const kase = await createCase({ title: title.trim(), folderId });
        for (const file of files) await createDocument({ caseId: kase.id, file });
      } else if (mode === "existing") {
        for (const file of files) await createDocument({ caseId: pickedCase!, file });
      } else {
        for (const file of files) {
          const kase = await createCase({ title: caseTitleFromFilename(file.name), folderId, loose: true });
          await createDocument({ caseId: kase.id, file });
        }
      }
    },
    onSuccess: async () => {
      toast.success(plural(files.length, "documento subido.", "documentos subidos."));
      await queryClient.invalidateQueries({ queryKey: ["drive"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo subir."),
  });

  const ready =
    files.length > 0 &&
    !upload.isPending &&
    (mode === "loose" || (mode === "new" && title.trim().length >= 3) || (mode === "existing" && !!pickedCase));

  return (
    <Dialog open={open} onOpenChange={(o) => !upload.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fixedCase ? `Agregar a «${fixedCase.title}»` : "Subir documentos"}</DialogTitle>
          <DialogDescription>
            {fixedCase ? "Se guardan dentro de este expediente." : "Elige dónde se guardan antes de subirlos."}
          </DialogDescription>
        </DialogHeader>

        <section aria-label="Archivos">
          <ul className="space-y-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <DocumentIcon className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Quitar ${f.name}`}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => input.current?.click()}>
            <FilePlus2 /> {files.length ? "Agregar otro PDF" : "Elegir PDF"}
          </Button>
        </section>

        {fixedCase ? null : (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">¿Dónde va?</legend>
            <div className="space-y-2">
              {MODES.map((m) => (
                <label
                  key={m.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                    mode === m.id ? "border-2 border-foreground" : "border-border",
                  )}
                >
                  <input type="radio" name="destino" className="peer sr-only" checked={mode === m.id} onChange={() => setMode(m.id)} />
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                      mode === m.id ? "border-foreground" : "border-border",
                    )}
                  >
                    {mode === m.id ? <span className="size-2.5 rounded-full bg-foreground" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">{m.hint}</span>

                    {m.id === "new" && mode === "new" ? (
                      <Input
                        className="mt-2.5"
                        aria-label="Nombre del expediente"
                        placeholder="Nombre del expediente"
                        value={title}
                        maxLength={200}
                        onChange={(e) => {
                          setTitle(e.target.value);
                          setTitleTouched(true);
                        }}
                      />
                    ) : null}

                    {m.id === "existing" && mode === "existing" ? (
                      <span className="mt-2.5 block">
                        <span className="relative block">
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            className="pl-9"
                            aria-label="Buscar expediente"
                            placeholder="Buscar expediente"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </span>
                        <span role="listbox" aria-label="Expedientes" className="mt-2 block max-h-44 space-y-1 overflow-y-auto">
                          {cases.isLoading ? (
                            <span className="block py-3 text-center text-xs text-muted-foreground">Buscando…</span>
                          ) : cases.data?.length ? (
                            cases.data.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                role="option"
                                aria-selected={pickedCase === c.id}
                                onClick={() => setPickedCase(c.id)}
                                className={cn(
                                  "flex w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left hover:bg-muted",
                                  pickedCase === c.id ? "border-2 border-foreground bg-accent/60" : "border-border",
                                )}
                              >
                                <CaseIcon className="size-8" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{c.title}</span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {plural(c.documentCount, "documento", "documentos")}
                                    {c.folderName ? ` · en ${c.folderName}` : ""}
                                  </span>
                                </span>
                              </button>
                            ))
                          ) : (
                            <span className="block py-3 text-center text-xs text-muted-foreground">
                              {deferredQuery ? "Ningún expediente coincide." : "Aún no tienes expedientes."}
                            </span>
                          )}
                        </span>
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={upload.isPending} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!ready} onClick={() => upload.mutate()}>
            {upload.isPending ? "Subiendo…" : files.length > 1 ? `Subir ${files.length} documentos` : "Subir documento"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
