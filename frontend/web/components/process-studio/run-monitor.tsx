"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/services/api-client";
import { fetchSent } from "@/services/inbox-service";
import { useSession } from "@/store/session-store";
import { cn } from "@/libs/utils";
import { matchesProcess, type ProcessDefinition } from "./model";
interface Run {
  id: string;
  signatureRequestId: string;
  processKey: string;
  status: string;
  lastError?: string | null;
  createdAt: string;
}

export function RunMonitor({ definition }: { definition: ProcessDefinition }) {
  const { signerId } = useSession();
  const [status, setStatus] = useState("todos");
  const [cursor, setCursor] = useState<string | null>(null);
  const [pages, setPages] = useState<Run[]>([]);
  const runs = useQuery({
    queryKey: ["process-runs", cursor],
    queryFn: () =>
      apiClient.get<{ items: Run[]; nextCursor: string | null }>(
        `/workflows?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    refetchInterval: cursor ? false : 30_000,
  });
  const sent = useQuery({
    queryKey: ["sent", signerId],
    queryFn: () => fetchSent(signerId),
  });
  const rows = [...pages, ...(runs.data?.items ?? [])].filter((r) =>
    matchesProcess(r.processKey, definition),
  );
  const visible = rows.filter(
    (r) =>
      status === "todos" ||
      (status === "atencion"
        ? /FALL|FAIL|ERROR/.test(r.status)
        : !/FALL|FAIL|ERROR|CANCEL|COMPLET/.test(r.status)),
  );
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Solicitudes de este proceso</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Estados reales del motor. Actualización cada 30 segundos.
          </p>
        </div>
        <select
          aria-label="Filtrar ejecuciones"
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="todos">Todos los estados</option>
          <option value="atencion">Requieren atención</option>
          <option value="activas">En curso</option>
        </select>
      </div>
      {runs.isError ? (
        <div role="alert">
          No se pudieron consultar las ejecuciones.{" "}
          <button className="underline" onClick={() => runs.refetch()}>
            Reintentar
          </button>
        </div>
      ) : runs.isPending ? (
        <p role="status">Consultando ejecuciones…</p>
      ) : visible.length ? (
        <ul className="divide-y divide-border border-y border-border">
          {visible.map((r) => {
            const request = sent.data?.find(
              (s) => s.signatureRequestId === r.signatureRequestId,
            );
            return (
              <li key={r.id} className="py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {request?.caseTitle ||
                        request?.documentTitle ||
                        `Solicitud ${r.signatureRequestId.slice(0, 8)}`}
                    </p>
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("es-MX")}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium",
                      /FALL|FAIL|ERROR/.test(r.status)
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted",
                    )}
                  >
                    {r.status.replaceAll("_", " ")}
                  </span>
                  {request && (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/documents/${request.documentId}`}>
                        Abrir expediente
                        <ArrowRight />
                      </Link>
                    </Button>
                  )}
                </div>
                {r.lastError && (
                  <details className="mt-3 rounded-lg bg-muted/60 p-3 text-sm">
                    <summary className="cursor-pointer font-medium">
                      Ver motivo y diagnóstico
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                      {r.lastError}
                    </p>
                    <p className="mt-3">
                      Revisa las tareas y la configuración antes de iniciar una
                      nueva solicitud.
                    </p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="py-12">
          <h3 className="font-medium">
            {status === "todos"
              ? "No hay solicitudes de este proceso en los registros cargados"
              : "No hay solicitudes con este estado"}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Las solicitudes aparecerán cuando un formato con este flujo se envíe
            a aprobación.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href={`/formatos?flow=${encodeURIComponent(definition.key)}`}>
              Ir a formatos
              <ArrowRight />
            </Link>
          </Button>
        </div>
      )}
      {runs.data?.nextCursor && (
        <Button
          variant="outline"
          className="mt-5"
          onClick={() => {
            setPages((p) => [...p, ...(runs.data?.items ?? [])]);
            setCursor(runs.data!.nextCursor);
          }}
        >
          Cargar registros anteriores
        </Button>
      )}
    </>
  );
}
