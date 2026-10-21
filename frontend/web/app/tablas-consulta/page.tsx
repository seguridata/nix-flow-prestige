"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleOff, Plus, Table2 } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { TableSchemaDialog } from "@/components/lookup/table-schema-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";
import { fetchLookupTables } from "@/services/lookup-tables-service";

export default function TablasConsultaPage() {
  const { roles } = useSession();
  const isAdmin = roles.includes("admin");
  const router = useRouter();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["lookup-tables"], queryFn: fetchLookupTables, enabled: isAdmin });
  const [creating, setCreating] = useState(false);

  return (
    <AppShell title="Tablas de consulta">
      <PageHeader
        title="Tablas de consulta"
        description="Datos que los flujos consultan para decidir a quién se envía cada paso o para calcular un dato. Quien llena un formato no las ve."
        actions={
          isAdmin ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Nueva tabla
            </Button>
          ) : undefined
        }
      />
      {!isAdmin ? (
        <p className="max-w-md text-sm text-muted-foreground">Solo el administrador puede ver y editar las tablas de consulta.</p>
      ) : (
        <div className="max-w-5xl">
          {list.isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Cargando las tablas">
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </div>
          ) : list.isError ? (
            <div role="alert" className="rounded-lg border border-border p-5 text-sm">
              No se pudieron cargar las tablas. {list.error instanceof Error ? list.error.message : ""}{" "}
              <Button variant="link" className="text-foreground underline" onClick={() => void list.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : (list.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Table2 />}
              title="Aún no hay tablas de consulta"
              description="Crea una, define sus columnas y carga las filas a mano o importándolas desde Excel o CSV."
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus /> Nueva tabla
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-background">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Tablas de consulta ({list.data!.length})</caption>
                <thead className="border-b border-border bg-muted/50 text-sm text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Nombre
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">
                      Clave
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">
                      Filas
                    </th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data!.map((t) => (
                    <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="max-w-md px-4 py-3 align-top">
                        <Link
                          href={`/tablas-consulta/${t.id}` as never}
                          className="font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t.name}
                        </Link>
                        {t.description ? <span className="mt-0.5 line-clamp-1 block text-sm text-muted-foreground">{t.description}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 align-top font-mono text-xs">{t.key}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right align-top tabular-nums">{t.rowCount}</td>
                      <td className="whitespace-nowrap px-4 py-3 align-top">
                        <span className={cn("inline-flex items-center gap-1.5", t.active ? "text-foreground" : "text-muted-foreground")}>
                          {t.active ? <CircleCheck className="size-4" aria-hidden /> : <CircleOff className="size-4" aria-hidden />}
                          {t.active ? "Activa" : "Desactivada"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {creating ? (
            <TableSchemaDialog
              table={null}
              onClose={() => setCreating(false)}
              onSaved={(t) => {
                setCreating(false);
                void qc.invalidateQueries({ queryKey: ["lookup-tables"] });
                router.push(`/tablas-consulta/${t.id}` as never);
              }}
            />
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
