"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Pencil, Trash2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { downloadTemplate, ImportDialog } from "@/components/lookup/import-dialog";
import { RowsGrid, rowsKey } from "@/components/lookup/rows-grid";
import { TableSchemaDialog } from "@/components/lookup/table-schema-dialog";
import { TestPanel } from "@/components/lookup/test-panel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { COLUMN_TYPE_LABEL } from "@/libs/lookup";
import { useSession } from "@/store/session-store";
import { deleteLookupTable, fetchLookupTable, updateLookupTable } from "@/services/lookup-tables-service";

export default function TablaConsultaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { roles } = useSession();
  const isAdmin = roles.includes("admin");
  const router = useRouter();
  const qc = useQueryClient();
  const table = useQuery({ queryKey: ["lookup-table", id], queryFn: () => fetchLookupTable(id), enabled: isAdmin, retry: false });

  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refreshTable = () => {
    void qc.invalidateQueries({ queryKey: ["lookup-table", id] });
    void qc.invalidateQueries({ queryKey: ["lookup-tables"] });
  };

  const toggle = useMutation({
    mutationFn: (active: boolean) => updateLookupTable(id, { active }),
    onSuccess: (t) => {
      toast.success(t.active ? "Tabla activada." : "Tabla desactivada: los formatos nuevos que la usen no se podrán crear.");
      refreshTable();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo cambiar el estado."),
  });
  const remove = useMutation({
    mutationFn: () => deleteLookupTable(id),
    onSuccess: () => {
      toast.success("Tabla eliminada.");
      void qc.invalidateQueries({ queryKey: ["lookup-tables"] });
      router.push("/tablas-consulta" as never);
    },
    onError: (e: Error) => {
      setConfirmDelete(false);
      setDeleteError(e.message || "No se pudo eliminar la tabla.");
    },
  });

  const t = table.data;

  return (
    <AppShell title={t?.name ?? "Tabla de consulta"}>
      <Link href={"/tablas-consulta" as never} className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Todas las tablas
      </Link>

      {!isAdmin ? (
        <p className="max-w-md text-sm text-muted-foreground">Solo el administrador puede ver y editar las tablas de consulta.</p>
      ) : table.isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Cargando la tabla">
          <Skeleton className="h-16 max-w-2xl rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : table.isError || !t ? (
        <div role="alert" className="rounded-lg border border-border p-5 text-sm">
          No se pudo cargar la tabla. {table.error instanceof Error ? table.error.message : ""}{" "}
          <Button variant="link" className="text-foreground underline" onClick={() => void table.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <div className="max-w-6xl space-y-8">
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold">{t.name}</h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Clave <span className="font-mono text-foreground">{t.key}</span> · revisión {t.revision} · {t.rowCount}{" "}
                  {t.rowCount === 1 ? "fila" : "filas"}
                </p>
                {t.description ? <p className="mt-1 max-w-2xl text-sm">{t.description}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 pr-2 text-sm">
                  <Switch checked={t.active} disabled={toggle.isPending} onCheckedChange={(c) => toggle.mutate(c)} />
                  {t.active ? "Activa" : "Desactivada"}
                </label>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil /> Esquema
                </Button>
                <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                  <Upload /> Importar
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadTemplate(t)}>
                  <Download /> Plantilla CSV
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Eliminar
                </Button>
              </div>
            </div>
            <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Columnas">
              {t.columns.map((c) => (
                <li key={c.key} className="rounded-full border border-border px-2.5 py-1">
                  {c.label} <span className="text-muted-foreground">· {COLUMN_TYPE_LABEL[c.type].toLowerCase()}</span>
                </li>
              ))}
            </ul>
            {deleteError ? (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-[#fbe9e7] p-3 text-sm text-[#8c2018]">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {deleteError}
              </p>
            ) : null}
          </header>

          <RowsGrid table={t} onCountChange={refreshTable} />
          <TestPanel table={t} />

          {editing ? (
            <TableSchemaDialog
              key={t.revision}
              table={t}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                refreshTable();
                void qc.invalidateQueries({ queryKey: rowsKey(id) });
              }}
            />
          ) : null}
          {importing ? (
            <ImportDialog
              table={t}
              onClose={() => setImporting(false)}
              onDone={() => {
                setImporting(false);
                refreshTable();
                void qc.invalidateQueries({ queryKey: rowsKey(id) });
              }}
            />
          ) : null}
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={`¿Eliminar la tabla «${t.name}»?`}
            description={`Se borran sus ${t.rowCount} filas. Si algún formato o flujo la usa, el sistema no la elimina y te dice cuáles.`}
            confirmLabel="Eliminar tabla"
            destructive
            pending={remove.isPending}
            onConfirm={() => remove.mutate()}
          />
        </div>
      )}
    </AppShell>
  );
}
