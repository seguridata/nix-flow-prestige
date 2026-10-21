"use client";

import { Plus, Trash2 } from "lucide-react";

import { SentenceChip, SentenceRow } from "@/components/flow/sentence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LOOKUP_OP_LABEL,
  opNeedsSource,
  opsForColumn,
  type LookupColumn,
  type LookupCondition,
  type LookupQuery,
  type LookupTableSummary,
  type SourceVar,
} from "@/libs/lookup";
import { cn } from "@/libs/utils";

export const selectClass =
  "h-10 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 aria-[invalid=true]:border-destructive";

/** Condición nueva sobre `column`, con el primer operador que admite su tipo. */
export function newCondition(column: LookupColumn | undefined, sources: readonly SourceVar[]): LookupCondition {
  return {
    column: column?.key ?? "",
    op: column ? opsForColumn(column.type)[0]! : "eq",
    source: sources[0] ? { var: sources[0].key } : { value: "" },
  };
}

interface Props {
  /** Prefijo de ids y de las etiquetas accesibles (único en la pantalla). */
  name: string;
  query: LookupQuery;
  onChange: (q: LookupQuery) => void;
  tables: readonly LookupTableSummary[];
  /** Datos del formulario que pueden ser fuente de una condición. */
  sources: readonly SourceVar[];
  /** En «Probar consulta» no hay formulario: solo valores fijos. */
  fixedOnly?: boolean;
  /** La tabla ya está elegida y no se cambia. */
  tableLocked?: boolean;
}

/**
 * Constructor de condiciones de una consulta: «valor de la solicitud» OPERADOR «columna de la tabla».
 * Todas las condiciones deben cumplirse (Y); gana la primera fila de la tabla que las cumple.
 */
export function QueryBuilder({ name, query, onChange, tables, sources, fixedOnly, tableLocked }: Props) {
  const table = tables.find((t) => t.key === query.table);
  const columns = table?.columns ?? [];
  const setCond = (i: number, c: LookupCondition) => onChange({ ...query, match: query.match.map((x, j) => (j === i ? c : x)) });
  const useVars = !fixedOnly && sources.length > 0;

  return (
    <div className="space-y-3">
      {!tableLocked ? (
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium">Tabla de consulta</span>
          <select
            className={cn(selectClass, "block w-full")}
            value={query.table}
            aria-invalid={!query.table}
            onChange={(e) => {
              const next = tables.find((t) => t.key === e.target.value);
              onChange({ table: e.target.value, match: next ? [newCondition(next.columns[0], useVars ? sources : [])] : [] });
            }}
          >
            <option value="">Elige una tabla…</option>
            {query.table && !table ? <option value={query.table}>{query.table} (ya no existe)</option> : null}
            {tables.map((t) => (
              <option key={t.id} value={t.key} disabled={!t.active && t.key !== query.table}>
                {t.name}
                {t.active ? "" : " (desactivada)"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {query.table ? (
        <>
          {query.match.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Se busca la primera fila de la tabla que cumpla <strong className="font-semibold">todas</strong> las condiciones.
            </p>
          ) : null}
          <ul className="space-y-2.5">
            {query.match.map((c, i) => {
              const col = columns.find((x) => x.key === c.column);
              const ops = col ? opsForColumn(col.type) : (Object.keys(LOOKUP_OP_LABEL) as (keyof typeof LOOKUP_OP_LABEL)[]);
              const needs = opNeedsSource(c.op);
              const kind: "var" | "value" = c.source && "var" in c.source ? "var" : "value";
              const n = `${name}, condición ${i + 1}`;
              const srcs = useVars ? sources : [];

              const varKey = c.source && "var" in c.source ? c.source.var : "";
              const fixed = c.source && "value" in c.source ? String(c.source.value).trim() : "";
              const sourceLabel =
                kind === "var" && useVars
                  ? varKey
                    ? (sources.find((s) => s.key === varKey)?.label || varKey)
                    : "elige el dato"
                  : fixed || "escribe un valor";

              const opChip = (
                <SentenceChip label={LOOKUP_OP_LABEL[c.op]} title={`Condición ${i + 1}: cómo se compara`}>
                  <select
                    className={cn(selectClass, "block w-full")}
                    aria-label={`${n}: operador`}
                    value={c.op}
                    onChange={(e) => setCond(i, withOp(c, e.target.value as LookupCondition["op"], srcs))}
                  >
                    {ops.map((o) => (
                      <option key={o} value={o}>
                        {LOOKUP_OP_LABEL[o]}
                      </option>
                    ))}
                  </select>
                  {needs ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-[#84bd00]"
                        checked={c.emptyMatchesAny !== false}
                        onChange={(e) => setCond(i, { ...c, emptyMatchesAny: e.target.checked })}
                      />
                      Celda vacía = cualquiera
                    </label>
                  ) : null}
                </SentenceChip>
              );
              const columnChip = (
                <SentenceChip label={col ? col.label : c.column ? `${c.column} (ya no existe)` : "elige la columna"} title={`Condición ${i + 1}: columna de la tabla`}>
                  <ColumnSelect name={n} columns={columns} value={c.column} onChange={(col2) => setCond(i, retarget(c, col2, columns, srcs))} />
                </SentenceChip>
              );

              return (
                <SentenceRow
                  key={i}
                  n={i + 1}
                  actions={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={`Quitar ${n}`}
                      onClick={() => onChange({ ...query, match: query.match.filter((_, j) => j !== i) })}
                    >
                      <Trash2 />
                    </Button>
                  }
                >
                  {i === 0 ? "Cuando" : "y"}{" "}
                  {needs ? (
                    <>
                      <SentenceChip label={sourceLabel} title={`Condición ${i + 1}: con qué se compara`}>
                        {useVars ? (
                          <select
                            className={cn(selectClass, "block w-full")}
                            aria-label={`${n}: de dónde sale el valor`}
                            value={kind}
                            onChange={(e) =>
                              setCond(i, { ...c, source: e.target.value === "var" ? { var: sources[0]?.key ?? "" } : { value: "" } })
                            }
                          >
                            <option value="var">Dato del formulario</option>
                            <option value="value">Valor fijo</option>
                          </select>
                        ) : null}
                        {kind === "var" && useVars ? (
                          <select
                            className={cn(selectClass, "block w-full")}
                            aria-label={`${n}: dato del formulario`}
                            value={varKey}
                            aria-invalid={!varKey}
                            onChange={(e) => setCond(i, { ...c, source: { var: e.target.value } })}
                          >
                            <option value="">Elige el dato…</option>
                            {sources.map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.label || s.key}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <ValueInput
                            label={`${n}: valor fijo`}
                            column={col}
                            value={c.source && "value" in c.source ? c.source.value : ""}
                            onChange={(v) => setCond(i, { ...c, source: { value: v } })}
                          />
                        )}
                      </SentenceChip>{" "}
                      {opChip} {columnChip}
                    </>
                  ) : (
                    <>
                      {columnChip} {opChip}
                    </>
                  )}
                </SentenceRow>
              );
            })}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!table}
            aria-label={query.match.length ? "Agregar otra condición" : undefined}
            onClick={() => onChange({ ...query, match: [...query.match, newCondition(columns[0], useVars ? sources : [])] })}
          >
            <Plus /> {query.match.length ? "Y también…" : "Agregar condición"}
          </Button>
        </>
      ) : null}
    </div>
  );
}

/** Al cambiar de operador: los de «vacío» no llevan fuente; los demás la necesitan. */
function withOp(c: LookupCondition, op: LookupCondition["op"], sources: readonly SourceVar[]): LookupCondition {
  if (!opNeedsSource(op)) {
    const { source: _omit, ...rest } = c;
    void _omit;
    return { ...rest, op };
  }
  return { ...c, op, source: c.source ?? (sources[0] ? { var: sources[0].key } : { value: "" }) };
}

/** Al cambiar de columna se conserva el operador si el nuevo tipo lo admite; si no, se toma el primero. */
function retarget(c: LookupCondition, key: string, columns: readonly LookupColumn[], sources: readonly SourceVar[]): LookupCondition {
  const col = columns.find((x) => x.key === key);
  if (!col) return { ...c, column: key };
  const ops = opsForColumn(col.type);
  const prev = columns.find((x) => x.key === c.column);
  const op = ops.includes(c.op) ? c.op : ops[0]!;
  const source = c.source && "value" in c.source && prev?.type !== col.type ? { value: "" } : (c.source ?? (sources[0] ? { var: sources[0].key } : { value: "" }));
  return { ...c, column: key, op, source };
}

function ColumnSelect({ name, columns, value, onChange }: { name: string; columns: readonly LookupColumn[]; value: string; onChange: (k: string) => void }) {
  return (
    <select className={cn(selectClass, "block w-full")} aria-label={`${name}: columna de la tabla`} value={value} aria-invalid={!value || !columns.some((c) => c.key === value)} onChange={(e) => onChange(e.target.value)}>
      <option value="">Columna…</option>
      {value && !columns.some((c) => c.key === value) ? <option value={value}>{value} (ya no existe)</option> : null}
      {columns.map((c) => (
        <option key={c.key} value={c.key}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

function ValueInput({
  label,
  column,
  value,
  onChange,
}: {
  label: string;
  column: LookupColumn | undefined;
  value: string | number;
  onChange: (v: string | number) => void;
}) {
  if (column?.type === "select" && (column.options?.length ?? 0) > 0) {
    return (
      <select className={cn(selectClass, "block w-full")} aria-label={label} value={String(value)} aria-invalid={String(value).trim() === ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Elige…</option>
        {column.options!.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Input
      className="h-10 w-full"
      aria-label={label}
      aria-invalid={String(value).trim() === ""}
      type={column?.type === "number" ? "number" : column?.type === "date" ? "date" : "text"}
      placeholder="Valor"
      value={String(value)}
      onChange={(e) => onChange(column?.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
    />
  );
}
