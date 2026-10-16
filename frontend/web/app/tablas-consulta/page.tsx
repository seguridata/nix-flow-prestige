"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleOff, Plus, Table2 } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { TableSchemaDialog } from "@/components/lookup/table-schema-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { plural } from "@/libs/drive";
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
    <AppShell
      title="Tablas de consulta"
      actions={
        isAdmin ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Nueva tabla
          </Button>
        ) : undefined
      }
    >
      {!isAdmin ? (
        <p className="max-w-md text-sm text-muted-foreground">Solo el administrador puede ver y editar las tablas de consulta.</p>
      ) : (
        <div className="max-w-5xl">
          <p className="mb-5 max-w-2xl text-sm text-muted-foreground">
            Una tabla de consulta guarda datos que los flujos usan para decidir solos a quién se envía cada paso (por área, tipo de gasto, monto…) o
            para calcular un dato. Quien usa un formato nunca ve estas tablas: solo ve a quién se enviará.
          </p>

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
            <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-14 text-center">
              <Table2 className="size-8 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-base font-medium">Aún no hay tablas de consulta</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Crea una, define sus columnas y carga las filas a mano o importándolas desde Excel o CSV.
              </p>
              <Button className="mt-4" onClick={() => setCreating(true)}>
                <Plus /> Nueva tabla
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <caption className="sr-only">Tablas de consulta ({list.data!.length})</caption>
                <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Nombre
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Clave
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Filas
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data!.map((t) => (
                    <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-3">
                        <Link
                          href={`/tablas-consulta/${t.id}` as never}
                          className="font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {t.name}
                        </Link>
                        {t.description ? <span className="block text-xs text-muted-foreground">{t.description}</span> : null}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">{t.key}</td>
                      <td className="px-3 py-3 tabular-nums">{plural(t.rowCount, "fila", "filas")}</td>
                      <td className="px-3 py-3">
                        <Badge variant={t.active ? "success" : "neutral"}>
                          {t.active ? <CircleCheck className="size-3.5" aria-hidden /> : <CircleOff className="size-3.5" aria-hidden />}
                          {t.active ? "Activa" : "Desactivada"}
                        </Badge>
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
