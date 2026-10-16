"use client";

import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CircleOff, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cellText, MAX_ROWS, norm, parseCell, rowValuesFromTexts, type LookupColumn, type LookupRow, type LookupTable } from "@/libs/lookup";
import { cn } from "@/libs/utils";
import {
  createLookupRow,
  deleteLookupRow,
  fetchAllLookupRows,
  reorderLookupRows,
  updateLookupRow,
  type RowValues,
} from "@/services/lookup-tables-service";

const PAGE = 100;
const cellClass =
  "h-9 w-full min-w-36 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none hover:border-input focus-visible:border-primary focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/40 aria-[invalid=true]:border-destructive aria-[invalid=true]:bg-[#fbe9e7]";

export const rowsKey = (tableId: string) => ["lookup-rows", tableId] as const;

/** Filas de una tabla como cuadrícula editable: el orden decide cuál fila gana, de arriba hacia abajo. */
export function RowsGrid({ table, onCountChange }: { table: LookupTable; onCountChange: () => void }) {
  const qc = useQueryClient();
  const uid = useId();
  const rowsQ = useQuery({ queryKey: rowsKey(table.id), queryFn: () => fetchAllLookupRows(table.id) });
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [removing, setRemoving] = useState<LookupRow | null>(null);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => rowsQ.data ?? [], [rowsQ.data]);
  const setRows = (fn: (r: LookupRow[]) => LookupRow[]) => qc.setQueryData<LookupRow[]>(rowsKey(table.id), (old) => fn(old ?? []));
  const refetchAll = () => void qc.invalidateQueries({ queryKey: rowsKey(table.id) });

  const filtering = search.trim() !== "";
  const visible = useMemo(() => {
    const q = norm(search);
    const withIndex = rows.map((r, i) => ({ row: r, index: i }));
    if (!q) return withIndex;
    return withIndex.filter(({ row }) => table.columns.some((c) => norm(cellText(row.values[c.key])).includes(q)));
  }, [rows, search, table.columns]);

  const update = useMutation({
    mutationFn: (v: { row: LookupRow; patch: { values?: RowValues; active?: boolean } }) => updateLookupRow(table.id, v.row.id, v.patch),
    onSuccess: (saved, v) => {
      setRows((rs) => rs.map((r) => (r.id === v.row.id ? { ...r, ...saved } : r)));
      onCountChange();
    },
    onError: (e: Error) => {
      toast.error(e.message || "No se pudo guardar el cambio.");
      refetchAll();
    },
  });
  const remove = useMutation({
    mutationFn: (r: LookupRow) => deleteLookupRow(table.id, r.id),
    onSuccess: (_d, r) => {
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      setRemoving(null);
      toast.success("Fila eliminada.");
      onCountChange();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar la fila."),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderLookupRows(table.id, ids),
    onError: (e: Error) => {
      toast.error(e.message || "No se pudo cambiar el orden.");
      refetchAll();
    },
    onSuccess: onCountChange,
  });
  const create = useMutation({
    mutationFn: (values: RowValues) => createLookupRow(table.id, values),
    onSuccess: (row) => {
      setRows((rs) => [...rs, row]);
      toast.success("Fila agregada al final de la tabla.");
      onCountChange();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo agregar la fila."),
  });

  function move(index: number, d: -1 | 1) {
    const j = index + d;
    if (j < 0 || j >= rows.length || reorder.isPending) return;
    const next = [...rows];
    [next[index], next[j]] = [next[j]!, next[index]!];
    setRows(() => next.map((r, i) => ({ ...r, position: i })));
    reorder.mutate(next.map((r) => r.id));
  }

  const busy = update.isPending || reorder.isPending || create.isPending;

  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`${uid}-h`} className="text-base font-semibold">
            Filas
          </h2>
          <p className="text-sm text-muted-foreground">
            Gana la <strong className="font-semibold">primera fila de arriba hacia abajo</strong> que cumple la consulta: pon lo más específico primero.
            Una celda vacía vale como «cualquiera».
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              className="h-9 w-60 pl-9"
              aria-label="Buscar en las filas"
              placeholder="Buscar en las filas"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShown(PAGE);
              }}
            />
          </div>
          <Button size="sm" onClick={() => setAdding(true)} disabled={rows.length >= MAX_ROWS || adding}>
            <Plus /> Agregar fila
          </Button>
        </div>
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-xs text-muted-foreground">
        {busy ? "Guardando…" : rowsQ.isSuccess ? `${rows.length} ${rows.length === 1 ? "fila" : "filas"} en la tabla.` : ""}
      </p>

      {rowsQ.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando las filas">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      ) : rowsQ.isError ? (
        <div role="alert" className="rounded-lg border border-border p-5 text-sm">
          No se pudieron cargar las filas. {rowsQ.error instanceof Error ? rowsQ.error.message : ""}{" "}
          <Button variant="link" className="text-foreground underline" onClick={() => void rowsQ.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          {rows.length === 0 && !adding ? (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-12 text-center">
              <p className="text-base font-medium">Esta tabla aún no tiene filas</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Agrega una fila, o importa un CSV o pega lo que copiaste de Excel desde «Importar».
              </p>
            </div>
          ) : null}

          {rows.length > 0 || adding ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm" style={{ minWidth: `${12 + table.columns.length * 10}rem` }}>
                <caption className="sr-only">Filas de la tabla {table.name}. Gana la primera que cumple la consulta.</caption>
                <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-20 px-2 py-2.5 font-medium">
                      Orden
                    </th>
                    {table.columns.map((c) => (
                      <th key={c.key} scope="col" className="px-2 py-2.5 font-medium">
                        {c.label}
                        <span className="ml-1 font-normal opacity-70">({c.type === "select" ? "lista" : c.type === "number" ? "número" : c.type === "date" ? "fecha" : "texto"})</span>
                      </th>
                    ))}
                    <th scope="col" className="w-24 px-2 py-2.5 font-medium">
                      Estado
                    </th>
                    <th scope="col" className="w-36 px-2 py-2.5 text-right font-medium">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, shown).map(({ row, index }) => (
                    <tr key={row.id} className={cn("border-b border-border last:border-0", !row.active && "bg-muted/40 text-muted-foreground")}>
                      <td className="px-2 py-1.5 tabular-nums">{index + 1}</td>
                      {table.columns.map((c) => (
                        <td key={c.key} className="px-1 py-1">
                          <CellEditor
                            key={`${c.key}:${cellText(row.values[c.key])}`}
                            column={c}
                            rowNumber={index + 1}
                            value={cellText(row.values[c.key])}
                            onCommit={(v) => {
                              const values: RowValues = {};
                              for (const col of table.columns) {
                                const cur = col.key === c.key ? v : row.values[col.key];
                                if (cur !== null && cur !== undefined && cur !== "") values[col.key] = cur;
                              }
                              update.mutate({ row, patch: { values } });
                            }}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <Badge variant={row.active ? "success" : "neutral"}>
                          {row.active ? null : <CircleOff className="size-3.5" aria-hidden />}
                          {row.active ? "Activa" : "Inactiva"}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => update.mutate({ row, patch: { active: !row.active } })}
                            aria-label={`${row.active ? "Desactivar" : "Activar"} la fila ${index + 1}`}
                          >
                            {row.active ? "Desactivar" : "Activar"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Subir la fila ${index + 1}`}
                            title={filtering ? "Quita la búsqueda para cambiar el orden" : undefined}
                            disabled={filtering || index === 0 || reorder.isPending}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Bajar la fila ${index + 1}`}
                            title={filtering ? "Quita la búsqueda para cambiar el orden" : undefined}
                            disabled={filtering || index === rows.length - 1 || reorder.isPending}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={`Eliminar la fila ${index + 1}`} onClick={() => setRemoving(row)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {adding ? (
                    <NewRow
                      columns={table.columns}
                      pending={create.isPending}
                      onCancel={() => setAdding(false)}
                      onSave={(values) =>
                        create.mutate(values, {
                          onSuccess: () => setAdding(false),
                        })
                      }
                    />
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}

          {filtering && visible.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              Ninguna fila coincide con «{search}».
            </p>
          ) : null}
          {visible.length > shown ? (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                Mostrar más ({visible.length - shown} restantes)
              </Button>
            </div>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="¿Eliminar esta fila?"
        description="Los pasos o variables que dependían de ella pasarán a la siguiente fila que coincida, o a preguntar. Las solicitudes ya creadas no cambian."
        confirmLabel="Eliminar"
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </section>
  );
}

/** Celda editable en línea: se guarda al salir del campo o con Enter; Escape devuelve el valor guardado. */
function CellEditor({
  column,
  rowNumber,
  value,
  onCommit,
}: {
  column: LookupColumn;
  rowNumber: number;
  value: string;
  onCommit: (v: string | number | null) => void;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const label = `${column.label}, fila ${rowNumber}`;

  function commit(raw: string) {
    if (raw.trim() === value.trim()) {
      setError(null);
      return;
    }
    const r = parseCell(column, raw);
    if (r.error) return setError(r.error);
    setError(null);
    onCommit(r.value);
  }

  if (column.type === "select") {
    return (
      <select
        className={cellClass}
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
      >
        <option value="">(cualquiera)</option>
        {text && !(column.options ?? []).includes(text) ? <option value={text}>{text}</option> : null}
        {(column.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <>
      <input
        className={cellClass}
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-e` : undefined}
        inputMode={column.type === "number" ? "decimal" : undefined}
        placeholder={column.type === "date" ? "AAAA-MM-DD" : "(cualquiera)"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(value);
            setError(null);
          }
        }}
      />
      {error ? (
        <p id={`${id}-e`} role="alert" className="flex items-start gap-1 px-2 pt-0.5 text-xs text-[#8c2018]">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
    </>
  );
}

function NewRow({
  columns,
  pending,
  onSave,
  onCancel,
}: {
  columns: LookupColumn[];
  pending: boolean;
  onSave: (values: RowValues) => void;
  onCancel: () => void;
}) {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);

  function save() {
    const { values, errors: errs } = rowValuesFromTexts(columns, texts);
    const problems = errs.map((e) => e.message);
    if (Object.keys(values).length === 0) problems.push("Llena al menos una celda: una fila vacía coincidiría con todo.");
    setErrors(problems);
    if (problems.length === 0) onSave(values);
  }

  return (
    <>
      <tr className="border-t-2 border-primary/50 bg-muted/30">
        <th scope="row" className="px-2 py-1.5 text-left text-xs font-medium">
          Fila nueva
        </th>
        {columns.map((c) => (
          <td key={c.key} className="px-1 py-1">
            {c.type === "select" ? (
              <select className={cellClass} aria-label={`${c.label}, fila nueva`} value={texts[c.key] ?? ""} onChange={(e) => setTexts((t) => ({ ...t, [c.key]: e.target.value }))}>
                <option value="">(cualquiera)</option>
                {(c.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={cn(cellClass, "border-input bg-background")}
                aria-label={`${c.label}, fila nueva`}
                inputMode={c.type === "number" ? "decimal" : undefined}
                placeholder={c.type === "date" ? "AAAA-MM-DD" : "(cualquiera)"}
                value={texts[c.key] ?? ""}
                onChange={(e) => setTexts((t) => ({ ...t, [c.key]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            )}
          </td>
        ))}
        <td />
        <td className="px-2 py-1.5">
          <div className="flex justify-end gap-1">
            <Button size="sm" disabled={pending} onClick={save}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </td>
      </tr>
      {errors.length > 0 ? (
        <tr>
          <td colSpan={columns.length + 3} className="px-2 pb-2">
            <ul role="alert" className="space-y-0.5 rounded-md bg-[#fbe9e7] p-2 text-xs text-[#8c2018]">
              {errors.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}
