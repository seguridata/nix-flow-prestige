"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CircleAlert, CircleCheck, FileText, Paperclip, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  acceptAttribute,
  acceptText,
  attachmentStatus,
  effectiveMin,
  formatBytes,
  validateFile,
  type AttachmentSpec,
} from "@/libs/attachments";
import { cn } from "@/libs/utils";
import { deleteStagedAttachment, uploadStagedAttachment } from "@/services/formats-service";

export interface UploadItem {
  id: string;
  specKey: string;
  name: string;
  size: number;
  status: "uploading" | "done" | "error";
  progress: number;
  stagedId?: string;
  error?: string;
}

let seq = 0;
const nextId = () => `up-${Date.now().toString(36)}-${++seq}`;

/** Estado de los anexos de un formato: carga previa (staging), progreso, validación inmediata y quitar. */
export function useAttachments(templateId: string, specs: readonly AttachmentSpec[]) {
  const [items, setItems] = useState<UploadItem[]>([]);
  /** Rechazos al elegir archivos (tipo, tamaño, máximo) y errores del servidor, por especificación. */
  const [notices, setNotices] = useState<Record<string, string[]>>({});
  const aborts = useRef(new Map<string, () => void>());
  const itemsRef = useRef<UploadItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Al salir se cancelan las cargas en curso; lo ya subido caduca solo en el servidor (24 h).
  useEffect(() => {
    const map = aborts.current;
    return () => {
      for (const abort of map.values()) abort();
    };
  }, []);

  const patch = (id: string, p: Partial<UploadItem>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const setNotice = (specKey: string, list: string[]) => setNotices((n) => ({ ...n, [specKey]: list }));

  const add = useCallback(
    (spec: AttachmentSpec, files: File[]) => {
      const rejected: string[] = [];
      let current = itemsRef.current.filter((x) => x.specKey === spec.key && x.status !== "error").length;
      for (const file of files) {
        const problem = validateFile(spec, file, current);
        if (problem) {
          rejected.push(problem);
          continue;
        }
        current++;
        const id = nextId();
        setItems((xs) => [...xs, { id, specKey: spec.key, name: file.name, size: file.size, status: "uploading", progress: 0 }]);
        const handle = uploadStagedAttachment(templateId, spec.key, file, (progress) => patch(id, { progress }));
        aborts.current.set(id, handle.abort);
        handle.promise
          .then((staged) => patch(id, { status: "done", progress: 100, stagedId: staged.stagedId }))
          .catch((e: Error) => patch(id, { status: "error", error: e.message || "No se pudo subir el archivo." }))
          .finally(() => aborts.current.delete(id));
      }
      setNotice(spec.key, rejected);
    },
    [templateId],
  );

  const remove = useCallback((item: UploadItem) => {
    aborts.current.get(item.id)?.();
    aborts.current.delete(item.id);
    setItems((xs) => xs.filter((x) => x.id !== item.id));
    setNotices((n) => ({ ...n, [item.specKey]: [] }));
    // Mejor esfuerzo: si falla, el archivo previo caduca solo.
    if (item.stagedId) void deleteStagedAttachment(item.stagedId).catch(() => undefined);
  }, []);

  const counts: Record<string, number> = {};
  for (const s of specs) counts[s.key] = items.filter((x) => x.specKey === s.key && x.status === "done").length;
  const uploading = items.some((x) => x.status === "uploading");
  const hasErrors = items.some((x) => x.status === "error");

  const staged = (): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const s of specs) {
      const ids = items.filter((x) => x.specKey === s.key && x.status === "done" && x.stagedId).map((x) => x.stagedId!);
      if (ids.length) out[s.key] = ids;
    }
    return out;
  };

  return { items, notices, counts, uploading, hasErrors, add, remove, staged, setNotice };
}

export type AttachmentsState = ReturnType<typeof useAttachments>;

/** Bloque «Anexos» del llenado: una zona de carga por especificación, con contador claro y errores por anexo. */
export function AttachmentsBlock({
  specs,
  state,
  serverErrors,
}: {
  specs: readonly AttachmentSpec[];
  state: AttachmentsState;
  serverErrors: Record<string, string>;
}) {
  const uid = useId();
  if (specs.length === 0) return null;
  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 id={`${uid}-h`} className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="size-4" aria-hidden /> Anexos
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Adjunta lo que pide este formato. No se puede enviar hasta cumplir los mínimos.</p>
      </div>
      {specs.map((s) => (
        <SpecZone key={s.key} spec={s} state={state} serverError={serverErrors[s.key]} />
      ))}
    </section>
  );
}

function SpecZone({ spec, state, serverError }: { spec: AttachmentSpec; state: AttachmentsState; serverError?: string }) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const mine = state.items.filter((x) => x.specKey === spec.key);
  const status = attachmentStatus(spec, state.counts[spec.key] ?? 0);
  const notices = state.notices[spec.key] ?? [];
  const full = mine.filter((x) => x.status !== "error").length >= spec.max;
  const hint = `${uid}-hint`;
  const accept = acceptAttribute(spec);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">
          {spec.label}
          {spec.required ? null : <span className="font-normal text-muted-foreground"> (opcional)</span>}
        </h3>
        <p
          role="status"
          className={cn("inline-flex items-center gap-1.5 text-xs font-medium", status.met ? "text-[#3f5900]" : "text-[#a15c00]")}
        >
          {status.met ? <CircleCheck className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
          <span>
            {status.text}
            {status.met ? (effectiveMin(spec) > 0 ? " · completo" : "") : ` · faltan ${status.missing}`}
          </span>
        </p>
      </div>
      {spec.help ? <p className="text-xs text-muted-foreground">{spec.help}</p> : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!full) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) state.add(spec, files);
        }}
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm transition-colors",
          over ? "border-foreground bg-muted" : "border-border",
          full && "opacity-60",
        )}
      >
        <input
          ref={input}
          id={`${uid}-file`}
          type="file"
          hidden
          multiple={spec.max > 1}
          accept={accept || undefined}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) state.add(spec, files);
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={full} aria-describedby={hint} onClick={() => input.current?.click()}>
          <Upload /> Elegir {spec.max > 1 ? "archivos" : "archivo"}
        </Button>
        <span id={hint} className="min-w-0 flex-1 text-xs text-muted-foreground">
          {full ? `Llegaste al máximo de ${spec.max}.` : "o arrástralos aquí."} Se aceptan: {acceptText(spec)} · hasta {spec.maxSizeMB} MB cada uno · máximo {spec.max}.
        </span>
      </div>

      {notices.length > 0 || serverError ? (
        <ul role="alert" className="space-y-1 rounded-md bg-[#fbe9e7] p-2.5 text-xs text-[#8c2018]">
          {[...notices, ...(serverError ? [serverError] : [])].map((m, i) => (
            <li key={i} className="flex gap-1.5">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {m}
            </li>
          ))}
        </ul>
      ) : null}

      {mine.length > 0 ? (
        <ul className="space-y-1.5" aria-label={`Archivos de ${spec.label}`}>
          {mine.map((it) => (
            <li key={it.id} className="rounded-md border border-border p-2 text-sm">
              <div className="flex items-center gap-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={it.name}>
                  {it.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(it.size)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={it.status === "uploading" ? `Cancelar la carga de ${it.name}` : `Quitar ${it.name}`}
                  onClick={() => state.remove(it)}
                >
                  <X />
                </Button>
              </div>
              {it.status === "uploading" ? (
                <div className="mt-1 flex items-center gap-2">
                  <progress className="h-1.5 flex-1 accent-[#84bd00]" max={100} value={it.progress} aria-label={`Subiendo ${it.name}`} />
                  <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">Subiendo {it.progress}%</span>
                </div>
              ) : it.status === "done" ? (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-[#3f5900]">
                  <CircleCheck className="size-3.5" aria-hidden /> Listo
                </p>
              ) : (
                <p role="alert" className="mt-0.5 flex items-start gap-1 text-xs text-[#8c2018]">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> No se subió: {it.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
