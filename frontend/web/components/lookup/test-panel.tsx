"use client";

import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, CircleX, FlaskConical, TriangleAlert } from "lucide-react";

import { QueryBuilder } from "@/components/lookup/query-builder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  cellText,
  describeFailure,
  queryProblems,
  type LookupQuery,
  type LookupTable,
  type LookupTableSummary,
  type LookupTestResult,
} from "@/libs/lookup";
import { testLookupQuery } from "@/services/lookup-tables-service";

const MAX_EXPLAIN = 50;

/** «Probar consulta»: el administrador pone valores de ejemplo y ve qué filas coinciden y por qué. */
export function TestPanel({ table }: { table: LookupTable }) {
  const uid = useId();
  const [query, setQuery] = useState<LookupQuery>({ table: table.key, match: [] });
  const [result, setResult] = useState<{ for: LookupQuery; data: LookupTestResult } | null>(null);

  const problems = queryProblems(query, { table, sources: [], where: "Consulta de prueba" });
  const run = useMutation({
    mutationFn: () => testLookupQuery(table.id, query, {}),
    onSuccess: (data) => setResult({ for: query, data }),
  });

  // El constructor trabaja con un resumen de la tabla; es la misma que ya está cargada.
  const summary: LookupTableSummary[] = [table];

  return (
    <section aria-labelledby={`${uid}-h`} className="max-w-4xl space-y-4">
      <div className="space-y-1">
        <h2 id={`${uid}-h`} className="flex items-center gap-2 text-base font-semibold">
          <FlaskConical className="size-4" aria-hidden /> Probar una consulta
        </h2>
        <p className="text-sm text-muted-foreground">Elige condiciones con valores de ejemplo, como si fueran los datos de una solicitud.</p>
        <p className="text-sm text-muted-foreground">Verás qué filas coinciden, cuál gana y por qué las demás no.</p>
      </div>

      <QueryBuilder
        name="Prueba"
        query={query}
        tables={summary}
        sources={[]}
        fixedOnly
        tableLocked
        onChange={(q) => {
          setQuery(q);
          setResult(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" className="min-w-28" disabled={problems.length > 0 || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Probando…" : "Probar"}
        </Button>
        {problems.length > 0 && query.match.length > 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {problems[0]!.replace(/^Consulta de prueba: /, "")}
          </p>
        ) : null}
      </div>

      {run.isError ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-[#8c2018]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          No se pudo probar la consulta. {run.error instanceof Error ? run.error.message : ""}
        </p>
      ) : null}

      {result ? <TestResult table={table} query={result.for} data={result.data} /> : null}
    </section>
  );
}

function TestResult({
  table,
  query,
  data,
}: {
  table: LookupTable;
  query: LookupQuery;
  data: LookupTestResult;
}) {
  const cols = table.columns.slice(0, 6);
  const failed = data.explain.filter((e) => e.failedAt !== undefined);
  const matches = data.matches;
  return (
    <div className="space-y-3" aria-live="polite">
      {matches.length === 0 ? (
        <p role="status" className="flex items-start gap-2 rounded-md bg-[#fdf1e0] p-3 text-sm text-[#a15c00]">
          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
          Ninguna fila coincide. Un paso con esta consulta preguntaría a quien use el formato; una variable calculada quedaría vacía (o impediría crear la solicitud).
        </p>
      ) : (
        <>
          <p role="status" className="flex items-start gap-2 rounded-md bg-[#eaf3d6] p-3 text-sm text-[#3f5900]">
            <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            {matches.length === 1 ? "Coincide 1 fila." : `Coinciden ${matches.length} filas.`} Gana la primera, de arriba hacia abajo.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Filas que coinciden con la prueba</caption>
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Orden
                  </th>
                  {cols.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-2 font-medium">
                      {c.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 font-medium">
                    Resultado
                  </th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m, i) => (
                  <tr key={m.rowId} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 tabular-nums">{m.order ?? m.position + 1}</td>
                    {cols.map((c) => (
                      <td key={c.key} className="px-3 py-2">
                        {cellText(m.values[c.key]) || <span className="text-muted-foreground">(cualquiera)</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {i === 0 ? (
                        <Badge variant="success">
                          <CircleCheck className="size-3.5" aria-hidden /> Gana
                        </Badge>
                      ) : (
                        <Badge variant="neutral">También coincide</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {failed.length > 0 ? (
        <details className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Por qué no coinciden las demás ({failed.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {failed.slice(0, MAX_EXPLAIN).map((e) => (
              <li key={e.rowId} className="flex gap-2">
                <span className="w-16 shrink-0 tabular-nums text-muted-foreground">Fila {e.order ?? "?"}</span>
                <span>{describeFailure(e.failedAt, query, table.columns)}</span>
              </li>
            ))}
          </ul>
          {failed.length > MAX_EXPLAIN ? <p className="mt-2 text-xs text-muted-foreground">…y {failed.length - MAX_EXPLAIN} más.</p> : null}
        </details>
      ) : null}
    </div>
  );
}
