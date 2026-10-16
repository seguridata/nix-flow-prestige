"use client";

import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { selectClass } from "@/components/lookup/query-builder";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  COLUMN_TYPE_LABEL,
  columnKeyFrom,
  MAX_COLUMNS,
  parseOptions,
  validateColumns,
  type LookupColumn,
  type LookupColumnType,
  type LookupTable,
} from "@/libs/lookup";
import { slugKey } from "@/libs/flow";
import { createLookupTable, updateLookupTable } from "@/services/lookup-tables-service";

interface Draft extends LookupColumn {
  /** Texto del campo de opciones mientras se escribe (se limpia al salir del campo). */
  optionsText: string;
  /** La columna ya existe en la tabla: su clave no se puede cambiar (se perderían sus datos). */
  existing: boolean;
}

const toDraft = (c: LookupColumn, existing: boolean): Draft => ({ ...c, optionsText: (c.options ?? []).join(", "), existing });

/** Alta de una tabla, o edición de su esquema de columnas (nombre, descripción y columnas). */
export function TableSchemaDialog({
  table,
  onClose,
  onSaved,
}: {
  table: LookupTable | null;
  onClose: () => void;
  onSaved: (t: LookupTable) => void;
}) {
  const uid = useId();
  const [name, setName] = useState(table?.name ?? "");
  const [key, setKey] = useState(table?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState(table?.description ?? "");
  const [columns, setColumns] = useState<Draft[]>(
    table ? table.columns.map((c) => toDraft(c, true)) : [toDraft({ key: "area", label: "Área", type: "text" }, false)],
  );
  const [errors, setErrors] = useState<string[]>([]);

  const clean = (): LookupColumn[] =>
    columns.map((c) => ({
      key: c.key,
      label: c.label.trim(),
      type: c.type,
      ...(c.type === "select" ? { options: parseOptions(c.optionsText) } : {}),
    }));

  const save = useMutation({
    mutationFn: () =>
      table
        ? updateLookupTable(table.id, { name: name.trim(), description: description.trim(), columns: clean() })
        : createLookupTable({ key: key.trim(), name: name.trim(), description: description.trim() || undefined, columns: clean() }),
    onSuccess: (t) => {
      toast.success(table ? "Esquema actualizado." : "Tabla creada.");
      onSaved(t);
    },
    onError: (e: Error) => setErrors([e.message || "No se pudo guardar."]),
  });

  const setCol = (i: number, patch: Partial<Draft>) => setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, d: -1 | 1) =>
    setColumns((cs) => {
      const j = i + d;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const problems: string[] = [];
    if (name.trim().length < 2) problems.push("Ponle un nombre a la tabla.");
    if (!table && !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key.trim())) {
      problems.push("La clave de la tabla debe empezar con letra y usar solo letras, números y guion bajo (máx. 40).");
    }
    problems.push(...validateColumns(clean()));
    setErrors(problems);
    if (problems.length === 0) save.mutate();
  }

  const removed = table ? table.columns.filter((c) => !columns.some((d) => d.key === c.key)) : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{table ? "Esquema de la tabla" : "Nueva tabla de consulta"}</DialogTitle>
          <DialogDescription>
            Define las columnas. Después podrás agregar filas, importarlas desde Excel o CSV y probar la consulta.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-name`} className="text-sm font-medium">
                Nombre
              </label>
              <Input
                id={`${uid}-name`}
                className="h-10"
                maxLength={120}
                placeholder="Ej. Responsables de gasto"
                value={name}
                aria-required="true"
                onChange={(e) => {
                  setName(e.target.value);
                  if (!table && !keyTouched) setKey(slugKey(e.target.value).replace(/^[^a-z]+/, "t_$&").slice(0, 40));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${uid}-key`} className="text-sm font-medium">
                Clave {table ? <span className="font-normal text-muted-foreground">(no se puede cambiar)</span> : null}
              </label>
              <Input
                id={`${uid}-key`}
                className="h-10 font-mono"
                value={key}
                readOnly={!!table}
                aria-describedby={`${uid}-key-help`}
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value);
                }}
              />
              <p id={`${uid}-key-help`} className="text-xs text-muted-foreground">
                Con ella citan la tabla los flujos.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-desc`} className="text-sm font-medium">
              Descripción <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <Input id={`${uid}-desc`} className="h-10" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <fieldset className="space-y-2.5">
            <legend className="text-sm font-medium">
              Columnas <span className="font-normal text-muted-foreground">({columns.length} de {MAX_COLUMNS})</span>
            </legend>
            <ul className="space-y-2">
              {columns.map((c, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="h-10 min-w-40 flex-1"
                      aria-label={`Nombre de la columna ${i + 1}`}
                      placeholder="Ej. Monto máximo"
                      value={c.label}
                      onChange={(e) => {
                        const label = e.target.value;
                        setCol(i, {
                          label,
                          // La clave de una columna nueva sigue a su nombre hasta que se edita a mano.
                          ...(c.existing ? {} : { key: columnKeyFrom(label, columns.filter((_, j) => j !== i).map((x) => x.key)) }),
                        });
                      }}
                    />
                    <select
                      className={selectClass}
                      aria-label={`Tipo de la columna ${i + 1}`}
                      value={c.type}
                      onChange={(e) => setCol(i, { type: e.target.value as LookupColumnType })}
                    >
                      {(Object.keys(COLUMN_TYPE_LABEL) as LookupColumnType[]).map((t) => (
                        <option key={t} value={t}>
                          {COLUMN_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="h-10 w-36 font-mono text-xs"
                      aria-label={`Clave de la columna ${i + 1}`}
                      value={c.key}
                      readOnly={c.existing}
                      title={c.existing ? "La clave de una columna existente no se puede cambiar." : undefined}
                      onChange={(e) => setCol(i, { key: e.target.value })}
                    />
                    <Button type="button" variant="ghost" size="icon" aria-label={`Subir la columna ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Bajar la columna ${i + 1}`} disabled={i === columns.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar la columna «${c.label || i + 1}»`}
                      onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {c.type === "select" ? (
                    <Input
                      className="mt-2 h-10"
                      aria-label={`Opciones de la columna ${i + 1}, separadas por coma`}
                      placeholder="Opciones separadas por coma: Tecnología, Finanzas, Ventas"
                      value={c.optionsText}
                      onChange={(e) => setCol(i, { optionsText: e.target.value })}
                      onBlur={() => setCol(i, { optionsText: parseOptions(c.optionsText).join(", ") })}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={columns.length >= MAX_COLUMNS}
              onClick={() => setColumns((cs) => [...cs, toDraft({ key: columnKeyFrom("columna", cs.map((x) => x.key)), label: "", type: "text" }, false)])}
            >
              <Plus /> Agregar columna
            </Button>
          </fieldset>

          {removed.length > 0 ? (
            <p role="status" className="flex items-start gap-2 rounded-md bg-[#fdf1e0] p-3 text-sm text-[#a15c00]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              Quitaste {removed.map((c) => `«${c.label}»`).join(", ")}: se perderán sus datos y los flujos que la usen dejarán de ser válidos.
            </p>
          ) : null}

          {errors.length > 0 ? (
            <ul role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-[#fbe9e7] p-3 text-sm text-[#8c2018]">
              {errors.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {m}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Guardando…" : table ? "Guardar esquema" : "Crear tabla"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
