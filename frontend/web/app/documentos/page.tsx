"use client";

import { Suspense, useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FolderPlus, Search, Upload } from "lucide-react";
import { toast } from "sonner";

import { CaseIcon, DocumentIcon, FolderIcon } from "@/components/drive/drive-icons";
import { DriveListHeader, DriveTile, DropCrumb, dragId, type TileActions } from "@/components/drive/drive-tile";
import { UploadDialog } from "@/components/drive/upload-dialog";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { buildEntries, plural, type DriveEntry } from "@/libs/drive";
import { fetchCase } from "@/services/cases-service";
import { fetchCaseDocuments } from "@/services/documents-service";
import {
  createFolder,
  deleteFolder,
  fetchDriveContents,
  updateCase,
  updateFolder,
} from "@/services/drive-service";

export default function DocumentosPage() {
  return (
    <AppShell title="Mis documentos">
      <Suspense>
        <Drive />
      </Suspense>
    </AppShell>
  );
}

function Drive() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const folderId = params.get("carpeta");
  const caseId = params.get("expediente");

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DriveEntry | null>(null);
  const [hoverFiles, setHoverFiles] = useState(false);
  const [upload, setUpload] = useState<{ key: number; files: File[] } | null>(null);
  const [nameDialog, setNameDialog] = useState<{ mode: "create" | "rename"; entry?: DriveEntry } | null>(null);
  const [toDelete, setToDelete] = useState<DriveEntry | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const contents = useQuery({
    queryKey: ["drive", folderId],
    queryFn: () => fetchDriveContents(folderId),
    enabled: !caseId,
  });
  const openCase = useQuery({ queryKey: ["drive-case", caseId], queryFn: () => fetchCase(caseId!), enabled: !!caseId });
  const caseDocs = useQuery({
    queryKey: ["drive-case-docs", caseId],
    queryFn: () => fetchCaseDocuments(caseId!),
    enabled: !!caseId,
  });

  const entries = useMemo(
    () => (contents.data ? buildEntries(contents.data.folders, contents.data.cases, query) : []),
    [contents.data, query],
  );
  const path = contents.data?.path ?? [];
  const parentOfCurrent = path.length >= 2 ? path[path.length - 2]!.id : null;

  const go = (next: { carpeta?: string | null; expediente?: string | null }) => {
    const sp = new URLSearchParams();
    if (next.carpeta) sp.set("carpeta", next.carpeta);
    if (next.expediente) sp.set("expediente", next.expediente);
    setQuery("");
    setSelected(null);
    router.push(`/documentos${sp.size ? `?${sp}` : ""}` as Route);
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["drive"] });

  const move = useMutation({
    mutationFn: ({ entry, target }: { entry: DriveEntry; target: string | null }) =>
      entry.kind === "folder" ? updateFolder(entry.id, { parentId: target }) : updateCase(entry.id, { folderId: target }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async (name: string) => {
      if (nameDialog?.mode === "create") return createFolder({ name, parentId: folderId });
      const entry = nameDialog!.entry!;
      return entry.kind === "folder" ? updateFolder(entry.id, { name }) : updateCase(entry.id, { title: name });
    },
    onSuccess: async () => {
      setNameDialog(null);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (entry: DriveEntry) => deleteFolder(entry.id),
    onSuccess: async () => {
      setToDelete(null);
      toast.success("Carpeta eliminada.");
      await refresh();
    },
    onError: (e: Error) => {
      setToDelete(null);
      toast.error(e.message);
    },
  });

  const actions: TileActions = {
    onOpen: (e) => {
      if (e.kind === "folder") go({ carpeta: e.id });
      else if (e.kind === "case") go({ expediente: e.id });
      else if (e.item.firstDocument) router.push(`/documents/${e.item.firstDocument.id}`);
    },
    onRename: (e) => setNameDialog({ mode: "rename", entry: e }),
    onDelete: (e) => setToDelete(e),
    onMoveUp: (e) => move.mutate({ entry: e, target: parentOfCurrent }),
    onSend: (e) => router.push(e.kind === "document" && e.item.firstDocument ? `/documents/${e.item.firstDocument.id}` : "/new"),
  };

  function onDragEnd(ev: DragEndEvent) {
    setDragging(null);
    const entry = entries.find((e) => dragId(e) === ev.active.id);
    const over = ev.over ? String(ev.over.id) : null;
    if (!entry || !over?.startsWith("folder:")) return;
    const raw = over.slice("folder:".length);
    const target = raw === "root" ? null : raw;
    if (entry.kind === "folder" && target === entry.id) return;
    if (target === folderId) return;
    move.mutate({ entry, target });
  }

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const loading = caseId ? openCase.isLoading || caseDocs.isLoading : contents.isLoading;
  const failed = caseId ? openCase.isError : contents.isError;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setDragging(entries.find((x) => dragId(x) === e.active.id) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        className="relative min-h-[60dvh]"
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setHoverFiles(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setHoverFiles(false);
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setHoverFiles(false);
          setUpload({ key: Date.now(), files: Array.from(e.dataTransfer.files) });
        }}
      >
        <PageHeader
          title={caseId ? (openCase.data?.title ?? "Expediente") : (path[path.length - 1]?.name ?? "Mis documentos")}
          description={
            caseId
              ? "Documentos de este expediente. Ábrelos para ver su estado o enviarlos a firma."
              : "Tus carpetas, expedientes y documentos. Sube un PDF o arrástralo aquí para empezar."
          }
          back={
            caseId
              ? { href: "/documentos", label: "Mis documentos" }
              : folderId
                ? {
                    href: parentOfCurrent ? `/documentos?carpeta=${parentOfCurrent}` : "/documentos",
                    label: parentOfCurrent ? (path[path.length - 2]?.name ?? "Atrás") : "Mis documentos",
                  }
                : undefined
          }
          actions={
            <>
              {caseId ? null : (
                <Button variant="outline" onClick={() => setNameDialog({ mode: "create" })}>
                  <FolderPlus /> Nueva carpeta
                </Button>
              )}
              <Button onClick={() => setUpload({ key: Date.now(), files: [] })}>
                <Upload /> Subir documento
              </Button>
            </>
          }
          className="mb-6"
        />

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <nav aria-label="Ruta" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            <DropCrumb folderId={null} current={!folderId && !caseId} onGo={() => go({})}>
              Mis documentos
            </DropCrumb>
            {path.map((p, i) => (
              <span key={p.id} className="flex items-center gap-0.5">
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                <DropCrumb folderId={p.id} current={i === path.length - 1 && !caseId} onGo={() => go({ carpeta: p.id })}>
                  {p.name}
                </DropCrumb>
              </span>
            ))}
            {caseId ? (
              <>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                <span aria-current="page" className="px-2.5 text-sm font-semibold">
                  {openCase.data?.title ?? "Expediente"}
                </span>
              </>
            ) : null}
          </nav>

          {caseId ? null : (
            <Field label="Buscar en esta carpeta" htmlFor="drive-search" className="w-full sm:w-64">
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="drive-search"
                  type="search"
                  className="pl-9"
                  placeholder="Nombre del elemento"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </Field>
          )}
        </div>

        {loading ? (
          <div className="divide-y divide-border rounded-lg border border-border" aria-busy aria-label="Cargando contenido">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <Skeleton className="size-10 shrink-0 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="hidden h-4 w-24 md:block" />
                <Skeleton className="h-11 w-16" />
              </div>
            ))}
          </div>
        ) : failed ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-5 text-sm">
            <span>No se pudo cargar esta vista.</span>
            <Button size="sm" variant="outline" onClick={() => (caseId ? openCase.refetch() : contents.refetch())}>
              Reintentar
            </Button>
          </div>
        ) : caseId ? (
          <CaseView
            docs={caseDocs.data ?? []}
            onOpen={(id) => router.push(`/documents/${id}`)}
            onAdd={() => setUpload({ key: Date.now(), files: [] })}
          />
        ) : entries.length === 0 ? (
          <Empty searching={!!query} onUpload={() => setUpload({ key: Date.now(), files: [] })} onFolder={() => setNameDialog({ mode: "create" })} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <DriveListHeader />
            <div role="listbox" aria-label="Contenido">
              {entries.map((entry) => (
              <DriveTile
                key={dragId(entry)}
                entry={entry}
                selected={selected === dragId(entry)}
                canMoveUp={!!folderId}
                onSelect={() => setSelected(dragId(entry))}
                actions={actions}
              />
              ))}
            </div>
          </div>
        )}

        {hoverFiles ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground bg-background/85">
            <p className="text-lg font-medium">Suelta tus PDF para subirlos</p>
          </div>
        ) : null}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="flex w-32 flex-col items-center rounded-lg border border-border bg-background/95 px-2 pb-3 pt-4 text-center shadow-lg">
            {dragging.kind === "folder" ? <FolderIcon /> : dragging.kind === "case" ? <CaseIcon /> : <DocumentIcon />}
            <span className="mt-2 line-clamp-2 text-sm font-medium leading-snug">{dragging.name}</span>
          </div>
        ) : null}
      </DragOverlay>

      {upload ? (
        <UploadDialog
          key={upload.key}
          open
          onOpenChange={(o) => !o && setUpload(null)}
          folderId={folderId}
          initialFiles={upload.files}
          fixedCase={caseId && openCase.data ? { id: caseId, title: openCase.data.title } : null}
        />
      ) : null}

      {nameDialog ? (
        <NameDialog
          key={nameDialog.entry?.id ?? "nueva"}
          title={
            nameDialog.mode === "create"
              ? "Nueva carpeta"
              : nameDialog.entry?.kind === "folder"
                ? "Cambiar nombre de la carpeta"
                : "Cambiar nombre del expediente"
          }
          initial={nameDialog.entry?.name ?? ""}
          minLength={nameDialog.entry?.kind === "case" ? 3 : 1}
          pending={save.isPending}
          onCancel={() => setNameDialog(null)}
          onSave={(n) => save.mutate(n)}
        />
      ) : null}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`¿Eliminar la carpeta «${toDelete?.name ?? ""}»?`}
        description="Solo se puede eliminar si está vacía. Tus expedientes y documentos nunca se borran desde aquí."
        confirmLabel="Eliminar carpeta"
        destructive
        pending={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </DndContext>
  );
}

function CaseView({
  docs,
  onOpen,
  onAdd,
}: {
  docs: { id: string; filename: string; version: number; locked: boolean }[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  if (docs.length === 0) {
    return (
      <EmptyState
        icon={<Upload />}
        title="Este expediente aún no tiene documentos"
        description="Agrega el primer PDF. Después podrás enviarlo a firma desde aquí."
        action={
          <Button onClick={onAdd}>
            <Upload /> Agregar documento
          </Button>
        }
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <p className="px-3 py-2 text-sm text-muted-foreground">{plural(docs.length, "documento", "documentos")}</p>
      <ul aria-label="Documentos del expediente" className="border-t border-border">
        {docs.map((d) => (
          <li key={d.id} className="flex min-h-16 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
            <DocumentIcon className="size-10 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-medium">{d.filename}</span>
              <span className="block text-sm text-muted-foreground">
                {d.locked ? "Congelado: ya no admite cambios" : `Versión ${d.version}`}
              </span>
            </span>
            <Button variant="outline" onClick={() => onOpen(d.id)} aria-label={`Abrir ${d.filename}`}>
              Abrir
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ searching, onUpload, onFolder }: { searching: boolean; onUpload: () => void; onFolder: () => void }) {
  if (searching) {
    return <EmptyState icon={<Search />} title="Nada coincide con tu búsqueda" description="Prueba con otra parte del nombre." />;
  }
  return (
    <EmptyState
      icon={<FolderPlus />}
      title="Esta carpeta está vacía"
      description="Sube un PDF, o arrástralo aquí, y elige si va en un expediente nuevo o en uno que ya tengas."
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={onUpload}>
            <Upload /> Subir documento
          </Button>
          <Button variant="outline" onClick={onFolder}>
            <FolderPlus /> Nueva carpeta
          </Button>
        </div>
      }
    />
  );
}

function NameDialog({
  title,
  initial,
  minLength,
  pending,
  onCancel,
  onSave,
}: {
  title: string;
  initial: string;
  minLength: number;
  pending: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const valid = name.trim().length >= minLength && name.trim() !== initial.trim();
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {minLength > 1 ? `Mínimo ${minLength} caracteres.` : "Elige un nombre corto y claro."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !pending) onSave(name);
          }}
        >
          <Field label="Nombre" htmlFor="drive-name">
            <Input id="drive-name" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
