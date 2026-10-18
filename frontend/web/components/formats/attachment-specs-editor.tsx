"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ACCEPT_LABEL,
  emptySpec,
  MAX_FILES_PER_SPEC,
  MAX_SIZE_MB,
  MAX_SPECS,
  type AttachmentAccept,
  type AttachmentSpec,
} from "@/libs/attachments";
import { columnKeyFrom } from "@/libs/lookup";
import { cn } from "@/libs/utils";

const ACCEPTS = Object.keys(ACCEPT_LABEL) as AttachmentAccept[];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** «Anexos del formato»: qué archivos debe adjuntar quien lo llena (cotizaciones, comprobantes…). */
export function AttachmentSpecsEditor({ value, onChange }: { value: AttachmentSpec[]; onChange: (v: AttachmentSpec[]) => void }) {
  const set = (i: number, patch: Partial<AttachmentSpec>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {value.map((s, i) => {
          const n = `anexo ${i + 1}`;
          return (
            <li key={i} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start gap-2">
                <label className="min-w-48 flex-1 space-y-1 text-sm">
                  <span className="font-medium">Nombre del {n}</span>
                  <Input
                    className="h-10"
                    maxLength={80}
                    placeholder="Ej. Cotizaciones"
                    value={s.label}
                    aria-invalid={!s.label.trim()}
                    onChange={(e) => set(i, { label: e.target.value })}
                    onBlur={() => {
                      // La clave nace del nombre la primera vez; después ya no se mueve (los datos enviados la usan).
                      if (/^anexo_\d+$/.test(s.key) && s.label.trim()) {
                        set(i, { key: columnKeyFrom(s.label, value.filter((_, j) => j !== i).map((x) => x.key)) });
                      }
                    }}
                  />
                  <span className="block text-xs text-muted-foreground">Escríbelo en plural si pide varios: «Cotizaciones».</span>
                </label>
                <label className="w-44 space-y-1 text-sm">
                  <span className="font-medium">Clave</span>
                  <Input className="h-10 font-mono text-xs" value={s.key} onChange={(e) => set(i, { key: e.target.value })} />
                </label>
                <Button type="button" variant="ghost" size="icon" className="mt-6" aria-label={`Quitar el ${n}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>

              <label className="mt-2 block space-y-1 text-sm">
                <span className="font-medium">
                  Ayuda <span className="font-normal text-muted-foreground">(opcional)</span>
                </span>
                <Input
                  className="h-10"
                  maxLength={200}
                  placeholder="Ej. Adjunta tres cotizaciones de proveedores distintos."
                  value={s.help ?? ""}
                  onChange={(e) => set(i, { help: e.target.value || undefined })}
                />
              </label>

              <div className="mt-2.5 flex flex-wrap items-end gap-x-4 gap-y-2.5 text-sm">
                <label className="flex items-center gap-2">
                  <Switch
                    checked={s.required}
                    aria-label={`${n}: obligatorio`}
                    onCheckedChange={(c) => set(i, { required: c, min: c ? Math.max(1, s.min) : s.min })}
                  />
                  Obligatorio
                </label>
                <label className="space-y-1">
                  <span className="block font-medium">Mínimo</span>
                  <Input
                    type="number"
                    className="h-10 w-20"
                    min={s.required ? 1 : 0}
                    max={MAX_FILES_PER_SPEC}
                    value={s.min}
                    onChange={(e) => set(i, { min: clamp(Number(e.target.value) || 0, 0, MAX_FILES_PER_SPEC) })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="block font-medium">Máximo</span>
                  <Input
                    type="number"
                    className="h-10 w-20"
                    min={1}
                    max={MAX_FILES_PER_SPEC}
                    value={s.max}
                    aria-invalid={s.min > s.max}
                    onChange={(e) => set(i, { max: clamp(Number(e.target.value) || 1, 1, MAX_FILES_PER_SPEC) })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="block font-medium">Tamaño máx. por archivo (MB)</span>
                  <Input
                    type="number"
                    className="h-10 w-24"
                    min={1}
                    max={MAX_SIZE_MB}
                    value={s.maxSizeMB}
                    onChange={(e) => set(i, { maxSizeMB: clamp(Number(e.target.value) || 1, 1, MAX_SIZE_MB) })}
                  />
                </label>
              </div>

              <fieldset className="mt-2.5">
                <legend className="mb-1.5 text-sm font-medium">Tipos aceptados</legend>
                <div className="flex flex-wrap gap-1.5">
                  {ACCEPTS.map((a) => {
                    const on = s.accept.includes(a);
                    return (
                      <button
                        key={a}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          // «Cualquier archivo» es excluyente con los demás tipos.
                          const next = a === "any" ? (on ? [] : ["any" as const]) : on ? s.accept.filter((x) => x !== a) : [...s.accept.filter((x) => x !== "any"), a];
                          set(i, { accept: next });
                        }}
                        className={cn(
                          "rounded-full border px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted",
                        )}
                      >
                        {ACCEPT_LABEL[a]}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={value.length >= MAX_SPECS}
        onClick={() => onChange([...value, emptySpec(value.map((x) => x.key))])}
      >
        <Plus /> Agregar anexo
      </Button>
      {value.length >= MAX_SPECS ? <p className="text-xs text-muted-foreground">Máximo {MAX_SPECS} anexos por formato.</p> : null}
    </div>
  );
}
