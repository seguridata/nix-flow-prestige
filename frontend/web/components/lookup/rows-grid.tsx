"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUp, CircleOff, Plus, Rows3, Search, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cellText,
  flattenRows,
  hasMoreRows,
  isFiltering,
  MAX_ROWS,
  parseCell,
  ROWS_PAGE_SIZE,
  rowsAfterAdd,
  rowsAfterMove,
  rowsAfterRemove,
  rowsAfterUpdate,
  rowsRemaining,
  rowsTotal,
  rowValuesFromTexts,
  type ActiveFilter,
  type LookupColumn,
  type LookupRow,
  type LookupTable,
  type MoveBody,
  type RowsData,
  type RowsFilters,
  type RowsPage,
} from "@/libs/lookup";
import { cn } from "@/libs/utils";
import {
  createLookupRow,
  deleteLookupRow,
  fetchLookupRows,
  moveLookupRow,
  updateLookupRow,
  type RowValues,
} from "@/services/lookup-tables-service";

const cellClass =
  "h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none hover:border-input focus-visible:border-primary focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/40 aria-[invalid=true]:border-destructive aria-[invalid=true]:bg-[#fbe9e7]";
const SEARCH_DEBOUNCE_MS = 300;
/** Columnas fijas a la izquierda: «Orden» (5rem) y la primera columna de datos. Necesitan fondo opaco (heredado de la fila). */
const stickyOrder = "sticky left-0 z-10 w-20 min-w-20 max-w-20 bg-inherit";
const stickyFirst = "sticky left-20 z-10 border-r border-border bg-inherit";
const COL_MIN: Record<LookupColumn["type"], string> = { text: "13rem", select: "13rem", number: "9rem", date: "10rem" };
const TYPE_LABEL: Record<LookupColumn["type"], string> = { text: "texto", select: "lista", number: "número", date: "fecha" };
const stickyShadow = "shadow-[6px_0_6px_-6px_rgba(25,25,25,0.35)]";
const nf = new Intl.NumberFormat("es-MX");

export const rowsKey = (tableId: string) => ["lookup-rows", tableId] as const;

type CacheData = InfiniteData<RowsPage, string | null>;
type MoveAct = "up" | "down" | "top";
type FocusAct = MoveAct | "toggle" | "remove";
/** Botón que debe recibir el foco cuando la lista se vuelva a pintar (tras mover, desactivar o borrar). */
interface FocusTarget {
  rowId: string | null;
  act: FocusAct;
}

const MOVE_BODY: Record<MoveAct, MoveBody> = { up: { direction: "up" }, down: { direction: "down" }, top: { toTop: true } };
/** Si el botón usado quedó deshabilitado (la fila llegó a un extremo), el foco pasa al contrario. */
const FOCUS_FALLBACK: Record<FocusAct, FocusAct> = { up: "down", top: "down", down: "up", toggle: "remove", remove: "toggle" };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Filas de una tabla como cuadrícula editable: el orden decide cuál fila gana, de arriba hacia abajo.
 * Trabaja por páginas de 50 con «Cargar más»; búsqueda y filtro de estado se resuelven en el servidor y reinician la lista.
 */
export function RowsGrid({ table, onCountChange }: { table: LookupTable; onCountChange: () => void }) {
  const qc = useQueryClient();
  const uid = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const addRef = useRef<HTMLButtonElement>(null);
  const focusRef = useRef<FocusTarget | null>(null);

  const [search, setSearch] = useState("");
  const [active, setActive] = useState<ActiveFilter>("all");
  const debounced = useDebounced(search, SEARCH_DEBOUNCE_MS);
  const filters = useMemo<RowsFilters>(() => ({ q: debounced.trim(), active }), [debounced, active]);
  // Mientras se escribe ya no se puede reordenar: el orden depende de TODA la tabla, no de lo que se ve.
  const filtering = isFiltering({ q: search, active });
  const typing = search.trim() !== debounced.trim();

  const [removing, setRemoving] = useState<LookupRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [announce, setAnnounce] = useState("");

  const key = useMemo(() => [...rowsKey(table.id), filters.q, filters.active] as const, [table.id, filters]);
  const rowsQ = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchLookupRows(table.id, { cursor: pageParam, limit: ROWS_PAGE_SIZE, ...filters }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });

  const data = rowsQ.data as RowsData | undefined;
  const rows = useMemo(() => (data ? flattenRows(data.pages) : []), [data]);
  const total = rowsTotal(data);
  const hasMore = hasMoreRows(data);
  const stale = rowsQ.isPlaceholderData;

  /** Cambia la lista cargada sin pedirla otra vez. */
  const patch = useCallback(
    (fn: (d: RowsData) => RowsData) => qc.setQueryData<CacheData>(key, (old) => (old ? (fn(old) as CacheData) : old)),
    [qc, key],
  );
  const reload = useCallback(() => void qc.invalidateQueries({ queryKey: rowsKey(table.id) }), [qc, table.id]);
  const neighborOf = (rowId: string): string | null => {
    const i = rows.findIndex((r) => r.id === rowId);
    return (rows[i + 1] ?? rows[i - 1])?.id ?? null;
  };

  // Devuelve el foco al botón que se estaba usando cuando la lista ya se volvió a pintar.
  useEffect(() => {
    const t = focusRef.current;
    if (!t) return;
    const root = tableRef.current;
    const find = (act: FocusAct) =>
      t.rowId ? root?.querySelector<HTMLButtonElement>(`button[data-row-id="${CSS.escape(t.rowId)}"][data-act="${act}"]`) : null;
    let el = find(t.act);
    if (!el || el.disabled) el = find(FOCUS_FALLBACK[t.act]);
    if (!el || el.disabled) {
      if (rowsQ.isFetching) return; // la fila aún no llegó: se reintenta con la siguiente carga
      el = t.rowId ? null : addRef.current;
    }
    focusRef.current = null;
    el?.focus();
  }, [data, rowsQ.isFetching]);

  // Indicadores de scroll horizontal: sombra junto a la columna fija y degradado en el borde derecho.
  const measureEdge = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measureEdge();
    const ro = new ResizeObserver(measureEdge);
    ro.observe(el);
    if (tableRef.current) ro.observe(tableRef.current);
    return () => ro.disconnect();
  }, [measureEdge, rows.length, adding]);

  const update = useMutation({
    mutationFn: (v: { row: LookupRow; patch: { values?: RowValues; active?: boolean } }) => updateLookupRow(table.id, v.row.id, v.patch),
    onSuccess: (saved, v) => {
      const next = neighborOf(v.row.id);
      let removed = false;
      patch((d) => {
        const r = rowsAfterUpdate(d, { ...v.row, ...saved }, filters);
        removed = r.removed;
        return r.data;
      });
      if (removed) {
        setAnnounce("La fila ya no cumple el filtro de estado y salió de la lista.");
        focusRef.current = { rowId: next, act: "toggle" };
      }
      onCountChange();
    },
    onError: (e: Error) => {
      toast.error(e.message || "No se pudo guardar el cambio.");
      reload();
    },
  });
  const remove = useMutation({
    mutationFn: (r: LookupRow) => deleteLookupRow(table.id, r.id),
    onSuccess: (_d, r) => {
      const next = neighborOf(r.id);
      patch((d) => rowsAfterRemove(d, r.id));
      // Si la lista cargada quedó vacía pero la tabla aún tiene filas, se pide la primera página otra vez.
      if (rows.length <= 1 && total > 1) reload();
      setRemoving(null);
      setAnnounce("Fila eliminada.");
      focusRef.current = { rowId: next, act: "remove" };
      toast.success("Fila eliminada.");
      onCountChange();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar la fila."),
  });
  const move = useMutation({
    mutationFn: (v: { row: LookupRow; act: MoveAct }) => moveLookupRow(table.id, v.row.id, MOVE_BODY[v.act]),
    onSuccess: (res, v) => {
      focusRef.current = { rowId: v.row.id, act: v.act };
      if (!res.moved) {
        setAnnounce(v.act === "down" ? "La fila ya está al final." : "La fila ya está al inicio.");
        return;
      }
      const cur = qc.getQueryData<CacheData>(key);
      const next = cur ? rowsAfterMove(cur as RowsData, res) : null;
      if (next) patch(() => next);
      else reload(); // el movimiento tocó filas que aún no estaban cargadas
      setAnnounce(`Fila movida a la posición ${nf.format(res.index)} de ${nf.format(res.total)}.`);
      onCountChange();
    },
    onError: (e: Error) => {
      focusRef.current = null;
      toast.error(e.message || "No se pudo cambiar el orden.");
      reload();
    },
  });
  const create = useMutation({
    mutationFn: (values: RowValues) => createLookupRow(table.id, values),
    onSuccess: (row) => {
      patch((d) => rowsAfterAdd(d, row, filters));
      const rank = table.rowCount + 1;
      const msg = `Fila agregada al final de la tabla (posición ${nf.format(rank)}).`;
      setAnnounce(msg);
      toast.success(hasMore ? `${msg} Usa «Cargar más» para verla.` : msg);
      onCountChange();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo agregar la fila."),
  });

  const { mutate: mutateUpdate } = update;
  const { mutate: mutateMove } = move;
  const onCommit = useCallback((row: LookupRow, values: RowValues) => mutateUpdate({ row, patch: { values } }), [mutateUpdate]);
  const onToggle = useCallback((row: LookupRow) => mutateUpdate({ row, patch: { active: !row.active } }), [mutateUpdate]);
  const onMove = useCallback((row: LookupRow, act: MoveAct) => mutateMove({ row, act }), [mutateMove]);
  const onRemove = useCallback((row: LookupRow) => setRemoving(row), []);

  async function loadMore() {
    const before = rows.length;
    const res = await rowsQ.fetchNextPage();
    if (res.data) {
      const all = flattenRows(res.data.pages);
      setAnnounce(`Se cargaron ${nf.format(all.length - before)} filas más. Mostrando ${nf.format(all.length)} de ${nf.format(rowsTotal(res.data as RowsData))}.`);
    }
  }

  const busy = update.isPending || move.isPending || create.isPending;
  const rowName = (i: number) => (filtering ? `resultado ${i + 1}` : `fila ${i + 1}`);
  const remaining = rowsRemaining(data);
  const canAdd = table.rowCount < MAX_ROWS && !adding;

  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-3">
      <h2 id={`${uid}-h`} className="sr-only">
        Filas
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Gana la <strong className="font-semibold text-foreground">primera fila de arriba hacia abajo</strong> que cumple la consulta. Una celda
          vacía vale como «cualquiera».
        </p>
        <Button ref={addRef} size="sm" className="min-h-11 sm:min-h-9" onClick={() => setAdding(true)} disabled={!canAdd}>
          <Plus /> Agregar fila
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-60 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            className="h-10 w-full pl-9"
            aria-label="Buscar en las filas"
            placeholder="Buscar en las filas"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Select aria-label="Mostrar filas" className="h-10" value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)}>
            <option value="all">Todas</option>
            <option value="active">Solo activas</option>
            <option value="inactive">Solo inactivas</option>
          </Select>
        </div>
      </div>

      {/* Lo que se anuncia a lectores de pantalla (mover, cargar más, borrar…); el conteo visible no es una región viva. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {busy || typing || stale ? <p className="text-xs text-muted-foreground">{busy ? "Guardando…" : "Buscando…"}</p> : null}
      {filtering ? (
        <p className="text-xs text-muted-foreground">Con búsqueda o filtro no se puede cambiar el orden: depende de toda la tabla. Quítalos para subir o bajar filas.</p>
      ) : null}

      {rowsQ.isLoading && !data ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando las filas">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      ) : rowsQ.isError && !data ? (
        <div role="alert" className="rounded-lg border border-border p-5 text-sm">
          No se pudieron cargar las filas. {rowsQ.error instanceof Error ? rowsQ.error.message : ""}{" "}
          <Button variant="link" className="text-foreground underline" onClick={() => void rowsQ.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          {rows.length === 0 && !adding && !filtering && !typing && !stale ? (
            <EmptyState
              icon={<Rows3 />}
              title="Esta tabla aún no tiene filas"
              description="Agrega una fila, o importa un CSV o pega lo que copiaste de Excel desde «Importar»."
            />
          ) : null}

          {rows.length > 0 || adding ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="relative">
                <div
                  ref={scrollRef}
                  tabIndex={0}
                  role="region"
                  aria-label={`Filas de ${table.name}, con desplazamiento`}
                  onScroll={measureEdge}
                  className={cn("max-h-[70dvh] overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", stale && "opacity-60")}
                  aria-busy={stale}
                >
                  <table ref={tableRef} className="w-max min-w-full border-separate border-spacing-0 text-left text-sm tabular-nums">
                    <caption className="sr-only">
                      Filas de la tabla {table.name}. Gana la primera que cumple la consulta. Se muestran {nf.format(rows.length)} de {nf.format(total)}.
                    </caption>
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="sticky left-0 top-0 z-30 w-20 min-w-20 max-w-20 border-b border-border bg-muted px-2 py-2.5 font-medium">
                          Orden
                        </th>
                        {table.columns.map((c, ci) => (
                          <th
                            key={c.key}
                            scope="col"
                            title={`${c.label} (${TYPE_LABEL[c.type]})`}
                            style={{ minWidth: COL_MIN[c.type] }}
                            className={cn(
                              "sticky top-0 border-b border-border bg-muted px-2 py-2.5 font-medium",
                              ci === 0 ? "left-20 z-30 border-r" : "z-20",
                              ci === 0 && edge.left && stickyShadow,
                            )}
                          >
                            <span className="block truncate">{c.label}</span>
                          </th>
                        ))}
                        <th scope="col" className="sticky top-0 z-20 w-24 border-b border-border bg-muted px-2 py-2.5 font-medium">
                          Estado
                        </th>
                        <th scope="col" className="sticky top-0 z-20 w-48 border-b border-border bg-muted px-2 py-2.5 text-right font-medium">
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <GridRow
                          key={row.id}
                          row={row}
                          columns={table.columns}
                          name={rowName(i)}
                          orderText={filtering ? "—" : String(i + 1)}
                          reorderable={!filtering && !stale}
                          moving={move.isPending}
                          isFirst={i === 0}
                          isLast={i === rows.length - 1 && !hasMore}
                          scrolled={edge.left}
                          onCommit={onCommit}
                          onToggle={onToggle}
                          onMove={onMove}
                          onRemove={onRemove}
                        />
                      ))}
                      {adding ? (
                        <NewRow
                          columns={table.columns}
                          pending={create.isPending}
                          scrolled={edge.left}
                          onCancel={() => {
                            setAdding(false);
                            requestAnimationFrame(() => addRef.current?.focus());
                          }}
                          onSave={(values) =>
                            create.mutate(values, {
                              onSuccess: () => {
                                setAdding(false);
                                requestAnimationFrame(() => addRef.current?.focus());
                              },
                            })
                          }
                        />
                      ) : null}
                    </tbody>
                  </table>
                </div>
                {edge.right ? (
                  <div aria-hidden className="pointer-events-none absolute bottom-0 right-0 top-0 w-8 bg-gradient-to-l from-foreground/15 to-transparent" />
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2.5">
                <p className="text-sm tabular-nums">
                  Mostrando <strong className="font-semibold">{nf.format(rows.length)}</strong> de {nf.format(total)} {total === 1 ? "fila" : "filas"}
                  {filtering ? ` que cumplen el filtro (la tabla tiene ${nf.format(table.rowCount)})` : ""}
                </p>
                {hasMore ? (
                  <Button variant="outline" size="sm" disabled={rowsQ.isFetchingNextPage || stale} onClick={() => void loadMore()}>
                    {rowsQ.isFetchingNextPage ? "Cargando…" : `Cargar más (quedan ${nf.format(remaining)})`}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {rows.length === 0 && (filtering || typing) && !stale && !adding ? (
            <div role="status" className="space-y-2 rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              <p>{search.trim() ? <>Ninguna fila coincide con «{search.trim()}».</> : "Ninguna fila cumple el filtro."}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setActive("all");
                }}
              >
                Quitar búsqueda y filtro
              </Button>
            </div>
          ) : null}

          {rowsQ.isFetchNextPageError || (rowsQ.isRefetchError && data) ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              No se pudieron cargar las filas. {rowsQ.error instanceof Error ? rowsQ.error.message : ""}
              <Button variant="link" className="h-auto p-0 text-foreground underline" onClick={() => (rowsQ.isFetchNextPageError ? void loadMore() : void rowsQ.refetch())}>
                Reintentar
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

interface GridRowProps {
  row: LookupRow;
  columns: LookupColumn[];
  /** «fila 3» o «resultado 3»: para los nombres accesibles de los controles. */
  name: string;
  orderText: string;
  reorderable: boolean;
  moving: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** El contenido se desplazó a la derecha: se pinta sombra junto a la columna fija. */
  scrolled: boolean;
  onCommit: (row: LookupRow, values: RowValues) => void;
  onToggle: (row: LookupRow) => void;
  onMove: (row: LookupRow, act: MoveAct) => void;
  onRemove: (row: LookupRow) => void;
}

const GridRow = memo(function GridRow({ row, columns, name, orderText, reorderable, moving, isFirst, isLast, scrolled, onCommit, onToggle, onMove, onRemove }: GridRowProps) {
  const hint = reorderable ? undefined : "Quita la búsqueda y el filtro para cambiar el orden";
  return (
    <tr className={cn("group", row.active ? "bg-background" : "bg-muted text-muted-foreground")}>
      <td className={cn(stickyOrder, "border-b border-border px-2 py-1.5 tabular-nums")}>{orderText}</td>
      {columns.map((c, ci) => (
        <td key={c.key} className={cn("border-b border-border px-1 py-1", ci === 0 && cn(stickyFirst, scrolled && stickyShadow))}>
          <CellEditor
            key={`${c.key}:${cellText(row.values[c.key])}`}
            column={c}
            rowLabel={name}
            value={cellText(row.values[c.key])}
            onCommit={(v) => {
              const values: RowValues = {};
              for (const col of columns) {
                const cur = col.key === c.key ? v : row.values[col.key];
                if (cur !== null && cur !== undefined && cur !== "") values[col.key] = cur;
              }
              onCommit(row, values);
            }}
          />
        </td>
      ))}
      <td className="border-b border-border px-2 py-1.5">
        <Badge variant={row.active ? "success" : "neutral"}>
          {row.active ? null : <CircleOff className="size-3.5" aria-hidden />}
          {row.active ? "Activa" : "Inactiva"}
        </Badge>
      </td>
      <td className="border-b border-border px-2 py-1.5">
        <div className="flex justify-end gap-0.5">
          <Button variant="ghost" size="sm" data-row-id={row.id} data-act="toggle" onClick={() => onToggle(row)} aria-label={`${row.active ? "Desactivar" : "Activar"} la ${name}`}>
            {row.active ? "Desactivar" : "Activar"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-row-id={row.id}
            data-act="top"
            aria-label={`Llevar la ${name} al inicio`}
            title={hint ?? "Llevar al inicio"}
            disabled={!reorderable || isFirst || moving}
            onClick={() => onMove(row, "top")}
          >
            <ChevronsUp />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-row-id={row.id}
            data-act="up"
            aria-label={`Subir la ${name}`}
            title={hint}
            disabled={!reorderable || isFirst || moving}
            onClick={() => onMove(row, "up")}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-row-id={row.id}
            data-act="down"
            aria-label={`Bajar la ${name}`}
            title={hint}
            disabled={!reorderable || isLast || moving}
            onClick={() => onMove(row, "down")}
          >
            <ArrowDown />
          </Button>
          <Button variant="ghost" size="icon" data-row-id={row.id} data-act="remove" aria-label={`Eliminar la ${name}`} onClick={() => onRemove(row)}>
            <Trash2 />
          </Button>
        </div>
      </td>
    </tr>
  );
});

/** Celda editable en línea: se guarda al salir del campo o con Enter; Escape devuelve el valor guardado. */
function CellEditor({
  column,
  rowLabel,
  value,
  onCommit,
}: {
  column: LookupColumn;
  rowLabel: string;
  value: string;
  onCommit: (v: string | number | null) => void;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [editingSelect, setEditingSelect] = useState(false);
  const id = useId();
  const label = `${column.label}, ${rowLabel}`;

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
    if (!editingSelect) {
      return (
        <button
          type="button"
          className={cn(cellClass, "flex items-center justify-between gap-2 text-left", !text && "text-muted-foreground")}
          aria-label={`${label}: ${text || "cualquiera"}. Editar`}
          title={text || "(cualquiera)"}
          onClick={() => setEditingSelect(true)}
        >
          <span className="min-w-0 truncate">{text || "(cualquiera)"}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
        </button>
      );
    }
    return (
      <select
        ref={(el) => {
          if (!el) return;
          el.focus();
          try {
            el.showPicker?.();
          } catch {
            /* sin selector nativo: basta con el foco */
          }
        }}
        className={cn(cellClass, "border-input bg-background")}
        aria-label={label}
        value={text}
        onBlur={() => setEditingSelect(false)}
        onKeyDown={(e) => e.key === "Escape" && setEditingSelect(false)}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
          setEditingSelect(false);
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
        className={cn(cellClass, "truncate")}
        aria-label={label}
        title={text || undefined}
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
  scrolled,
  onSave,
  onCancel,
}: {
  columns: LookupColumn[];
  pending: boolean;
  scrolled: boolean;
  onSave: (values: RowValues) => void;
  onCancel: () => void;
}) {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const rowRef = useRef<HTMLTableRowElement>(null);

  // Al abrir la fila nueva, el foco va a su primera celda y se asegura que sea visible.
  useEffect(() => {
    const first = rowRef.current?.querySelector<HTMLElement>("input, select");
    first?.focus();
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  function save() {
    const { values, errors: errs } = rowValuesFromTexts(columns, texts);
    const problems = errs.map((e) => e.message);
    if (Object.keys(values).length === 0) problems.push("Llena al menos una celda: una fila vacía coincidiría con todo.");
    setErrors(problems);
    if (problems.length === 0) onSave(values);
  }

  return (
    <>
      <tr ref={rowRef} className="bg-muted">
        <th scope="row" className={cn(stickyOrder, "border-t-2 border-primary/50 px-2 py-1.5 text-left text-xs font-medium")}>
          Fila nueva
          <span className="block font-normal text-muted-foreground">al final</span>
        </th>
        {columns.map((c, ci) => (
          <td key={c.key} className={cn("border-t-2 border-primary/50 px-1 py-1", ci === 0 && cn(stickyFirst, scrolled && stickyShadow))}>
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
        <td className="border-t-2 border-primary/50" />
        <td className="border-t-2 border-primary/50 px-2 py-1.5">
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
