"use client";

import { Suspense, useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FolderPlus, Search, Upload } from "lucide-react";
import { toast } from "sonner";

import { CaseIcon, DocumentIcon, FolderIcon } from "@/components/drive/drive-icons";
import { DriveTile, DropCrumb, dragId, type TileActions } from "@/components/drive/drive-tile";
import { UploadDialog } from "@/components/drive/upload-dialog";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { buildEntries, type DriveEntry } from "@/libs/drive";
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
        <div className="mb-5 flex flex-wrap items-center gap-3">
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
                <span className="px-2 py-1 text-sm font-semibold">{openCase.data?.title ?? "Expediente"}</span>
              </>
            ) : null}
          </nav>

          {caseId ? null : (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 w-56 pl-9"
                aria-label="Buscar en esta carpeta"
                placeholder="Buscar en esta carpeta"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {caseId ? null : (
            <Button variant="outline" size="sm" onClick={() => setNameDialog({ mode: "create" })}>
              <FolderPlus /> Nueva carpeta
            </Button>
          )}
          <Button size="sm" onClick={() => setUpload({ key: Date.now(), files: [] })}>
            <Upload /> Subir
          </Button>
        </div>

        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2" aria-busy>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-lg" />
            ))}
          </div>
        ) : failed ? (
          <div role="alert" className="rounded-lg border border-border p-6 text-sm">
            No se pudo cargar esta vista.{" "}
            <Button variant="link" onClick={() => (caseId ? openCase.refetch() : contents.refetch())}>
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
          <div role="listbox" aria-label="Contenido" className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
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
        )}

        {hoverFiles ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground bg-background/85">
            <p className="text-base font-medium">Suelta tus PDF para subirlos</p>
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
      <div className="flex flex-col items-center py-16 text-center">
        <CaseIcon className="size-20" />
        <p className="mt-4 text-base font-medium">Este expediente aún no tiene documentos</p>
        <Button className="mt-4" onClick={onAdd}>
          <Upload /> Agregar documento
        </Button>
      </div>
    );
  }
  return (
    <div role="listbox" aria-label="Documentos del expediente" className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
      {docs.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => onOpen(d.id)}
          className="flex flex-col items-center rounded-lg border border-transparent px-2 pb-3 pt-4 text-center outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <DocumentIcon />
          <span className="mt-2 line-clamp-2 w-full break-words text-sm font-medium leading-snug">{d.filename}</span>
          <span className="mt-0.5 text-xs text-muted-foreground">{d.locked ? "Congelado" : `Versión ${d.version}`}</span>
        </button>
      ))}
    </div>
  );
}

function Empty({ searching, onUpload, onFolder }: { searching: boolean; onUpload: () => void; onFolder: () => void }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <FolderIcon className="size-20" />
      <p className="mt-4 text-base font-medium">{searching ? "Nada coincide con tu búsqueda" : "Esta carpeta está vacía"}</p>
      {searching ? null : (
        <>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Sube un PDF, o arrástralo aquí, y elige si va en un expediente nuevo o en uno que ya tengas.
          </p>
          <div className="mt-4 flex gap-2">
            <Button onClick={onUpload}>
              <Upload /> Subir documento
            </Button>
            <Button variant="outline" onClick={onFolder}>
              <FolderPlus /> Nueva carpeta
            </Button>
          </div>
        </>
      )}
    </div>
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
          <Input autoFocus aria-label="Nombre" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
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
