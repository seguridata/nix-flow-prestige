"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  Download,
  FileDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ExportStatus, useExportRows } from "@/components/lookup/export-button";
import {
  downloadTemplate,
  ImportDialog,
} from "@/components/lookup/import-dialog";
import { RowsGrid, rowsKey } from "@/components/lookup/rows-grid";
import { TableSchemaDialog } from "@/components/lookup/table-schema-dialog";
import { TestPanel } from "@/components/lookup/test-panel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { COLUMN_TYPE_LABEL } from "@/libs/lookup";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";
import {
  deleteLookupTable,
  fetchLookupTable,
  updateLookupTable,
} from "@/services/lookup-tables-service";

const TABS = [
  { value: "filas", label: "Filas" },
  { value: "probar", label: "Probar una consulta" },
  { value: "columnas", label: "Columnas" },
] as const;

export default function TablaConsultaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { roles } = useSession();
  const isAdmin = roles.includes("admin");
  const router = useRouter();
  const qc = useQueryClient();
  const table = useQuery({
    queryKey: ["lookup-table", id],
    queryFn: () => fetchLookupTable(id),
    enabled: isAdmin,
    retry: false,
  });

  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("filas");

  const refreshTable = () => {
    void qc.invalidateQueries({ queryKey: ["lookup-table", id] });
    void qc.invalidateQueries({ queryKey: ["lookup-tables"] });
  };

  const toggle = useMutation({
    mutationFn: (active: boolean) => updateLookupTable(id, { active }),
    onSuccess: (t) => {
      toast.success(
        t.active
          ? "Tabla activada."
          : "Tabla desactivada: los formatos nuevos que la usen no se podrán crear.",
      );
      refreshTable();
    },
    onError: (e: Error) =>
      toast.error(e.message || "No se pudo cambiar el estado."),
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
  const exporter = useExportRows(t);

  return (
    <AppShell title={t?.name ?? "Tabla de consulta"}>
      <div className="pb-28">
        <PageHeader
          back={{ href: "/tablas-consulta", label: "Todas las tablas" }}
          title={t?.name ?? "Tabla de consulta"}
          description={isAdmin && t?.description ? t.description : undefined}
          meta={
            isAdmin && t ? (
              <>
                Clave{" "}
                <span className="whitespace-nowrap font-mono text-foreground">
                  {t.key}
                </span>{" "}
                · revisión <span className="tabular-nums">{t.revision}</span> ·{" "}
                <span className="tabular-nums">{t.rowCount}</span>{" "}
                {t.rowCount === 1 ? "fila" : "filas"}
              </>
            ) : undefined
          }
          actions={
            isAdmin && t ? (
              <>
                <label className="flex items-center gap-2 pr-2 text-sm">
                  <Switch
                    checked={t.active}
                    disabled={toggle.isPending}
                    onCheckedChange={(c) => toggle.mutate(c)}
                  />
                  {t.active ? "Activa" : "Desactivada"}
                </label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <MoreHorizontal /> Más acciones
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(true)}>
                      <Pencil /> Editar esquema
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setImporting(true)}>
                      <Upload /> Importar filas
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => downloadTemplate(t)}>
                      <Download /> Descargar plantilla CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={exporter.running || t.rowCount === 0}
                      onSelect={() => void exporter.run()}
                    >
                      <FileDown /> Exportar filas a CSV
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={() => setConfirmDelete(true)}
                    >
                      <Trash2 /> Eliminar tabla
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ExportStatus exporter={exporter} />
              </>
            ) : undefined
          }
        />

        {!isAdmin ? (
          <p className="max-w-md text-sm text-muted-foreground">
            Solo el administrador puede ver y editar las tablas de consulta.
          </p>
        ) : table.isLoading ? (
          <div
            className="space-y-3"
            aria-busy="true"
            aria-label="Cargando la tabla"
          >
            <Skeleton className="h-16 max-w-2xl rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
        ) : table.isError || !t ? (
          <div
            role="alert"
            className="rounded-lg border border-border p-5 text-sm"
          >
            No se pudo cargar la tabla.{" "}
            {table.error instanceof Error ? table.error.message : ""}{" "}
            <Button
              variant="link"
              className="text-foreground underline"
              onClick={() => void table.refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="max-w-6xl space-y-4">
            {deleteError ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-[#fbe9e7] p-3 text-sm text-[#8c2018]"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{" "}
                {deleteError}
              </p>
            ) : null}

            <TabsPrimitive.Root value={tab} onValueChange={setTab}>
              <TabsPrimitive.List
                aria-label="Secciones de la tabla"
                className="-mx-4 flex overflow-x-auto border-b border-border px-4 [scrollbar-width:thin] sm:mx-0 sm:px-0"
              >
                {TABS.map((x) => (
                  <TabsPrimitive.Trigger
                    key={x.value}
                    value={x.value}
                    className={cn(
                      "min-h-11 shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      "data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground",
                    )}
                  >
                    {x.label}
                    {x.value === "filas" ? (
                      <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                        {t.rowCount}
                      </span>
                    ) : null}
                  </TabsPrimitive.Trigger>
                ))}
              </TabsPrimitive.List>

              {/* forceMount: al cambiar de pestaña se conservan la búsqueda, el filtro y la consulta de prueba. */}
              <TabsPrimitive.Content
                value="filas"
                forceMount
                className="pt-5 outline-none data-[state=inactive]:hidden"
              >
                <RowsGrid table={t} onCountChange={refreshTable} />
              </TabsPrimitive.Content>
              <TabsPrimitive.Content
                value="probar"
                forceMount
                className="pt-5 outline-none data-[state=inactive]:hidden"
              >
                <TestPanel table={t} />
              </TabsPrimitive.Content>
              <TabsPrimitive.Content
                value="columnas"
                className="pt-5 outline-none"
              >
                <section
                  aria-label="Columnas de la tabla"
                  className="max-w-3xl space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="max-w-xl text-sm text-muted-foreground">
                      Estas son las columnas por las que se consulta la tabla.
                      Cambiar el esquema no borra las filas, pero puede pedirte
                      revisarlas.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(true)}
                    >
                      <Pencil /> Editar esquema
                    </Button>
                  </div>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {t.columns.map((c) => (
                      <li
                        key={c.key}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm"
                      >
                        <span className="font-medium">{c.label}</span>
                        <span className="text-muted-foreground">
                          {COLUMN_TYPE_LABEL[c.type]}
                          {c.type === "select" && c.options?.length
                            ? ` · ${c.options.length} opciones`
                            : ""}
                          {" · "}
                          <span className="font-mono">{c.key}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </TabsPrimitive.Content>
            </TabsPrimitive.Root>

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
      </div>
    </AppShell>
  );
}
