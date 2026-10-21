"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ArrowUpFromLine, CircleCheck, CircleDot, Clock, ExternalLink, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";

import { CaseIcon, DocumentIcon, FolderIcon } from "@/components/drive/drive-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DriveEntry } from "@/libs/drive";
import { cn } from "@/libs/utils";

export const dragId = (e: Pick<DriveEntry, "kind" | "id">) => `${e.kind}:${e.id}`;
export const dropId = (folderId: string | null) => `folder:${folderId ?? "root"}`;

const KIND_LABEL = { folder: "Carpeta", case: "Expediente", document: "Documento" } as const;

/** Columnas de la lista: nombre, tipo, estado, fecha y acciones. En móvil solo nombre y acciones. */
export const DRIVE_COLUMNS = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_7.5rem_8.5rem_7rem_auto]";

const STATUS: Record<string, { label: string; icon: typeof CircleDot }> = {
  ABIERTO: { label: "Abierto", icon: CircleDot },
  EN_PROCESO: { label: "En proceso", icon: Clock },
  CERRADO: { label: "Cerrado", icon: CircleCheck },
};

const date = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });

export interface TileActions {
  onOpen: (e: DriveEntry) => void;
  onRename: (e: DriveEntry) => void;
  onDelete: (e: DriveEntry) => void;
  onMoveUp: (e: DriveEntry) => void;
  onSend: (e: DriveEntry) => void;
}

/** Encabezado de la lista (solo escritorio). Sin mayúsculas decorativas. */
export function DriveListHeader() {
  return (
    <div aria-hidden className={cn("hidden gap-x-4 border-b border-border px-3 pb-2 text-sm text-muted-foreground md:grid", DRIVE_COLUMNS)}>
      <span>Nombre</span>
      <span>Tipo</span>
      <span>Estado</span>
      <span>Creado</span>
      <span className="w-24" />
    </div>
  );
}

function StatusCell({ entry }: { entry: DriveEntry }) {
  if (entry.kind === "folder") return <span className="text-muted-foreground">—</span>;
  const st = STATUS[entry.item.status];
  if (!st) return <span className="text-muted-foreground">{entry.item.status}</span>;
  const Icon = st.icon;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {st.label}
    </span>
  );
}

/**
 * Fila del explorador. Se arrastra (carpetas, expedientes y documentos) y las carpetas
 * reciben lo que se suelta encima. Todo lo que hace el arrastre también está en el menú «Más».
 */
export function DriveTile({
  entry,
  selected,
  canMoveUp,
  onSelect,
  actions,
}: {
  entry: DriveEntry;
  selected: boolean;
  canMoveUp: boolean;
  onSelect: () => void;
  actions: TileActions;
}) {
  const { setNodeRef: setDragRef, attributes, listeners, isDragging } = useDraggable({ id: dragId(entry) });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: dropId(entry.id), disabled: entry.kind !== "folder" });
  const created = entry.kind === "folder" ? null : new Date(entry.item.createdAt);

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        if (entry.kind === "folder") setDropRef(node);
      }}
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={selected}
      aria-label={`${KIND_LABEL[entry.kind]}: ${entry.name}. ${entry.detail}`}
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={() => actions.onOpen(entry)}
      onFocus={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter") actions.onOpen(entry);
        if (e.key === "F2" && entry.kind !== "document") actions.onRename(entry);
        if (e.key === "Delete" && entry.kind === "folder") actions.onDelete(entry);
      }}
      className={cn(
        "grid min-h-16 cursor-default select-none items-center gap-x-4 border-b border-border px-3 py-2 text-sm outline-none transition-colors last:border-b-0 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        DRIVE_COLUMNS,
        selected && "bg-accent/60 hover:bg-accent/60",
        isOver && "bg-accent ring-2 ring-inset ring-foreground",
        isDragging && "opacity-40",
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0">
          {entry.kind === "folder" ? <FolderIcon className="size-10" /> : entry.kind === "case" ? <CaseIcon className="size-10" /> : <DocumentIcon className="size-10" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-base font-medium">{entry.name}</span>
          <span className="block truncate text-muted-foreground">
            <span className="md:hidden">{KIND_LABEL[entry.kind]}{entry.detail ? " · " : ""}</span>
            {entry.detail}
          </span>
        </span>
      </span>
      <span className="hidden md:block">{KIND_LABEL[entry.kind]}</span>
      <span className="hidden md:block">
        <StatusCell entry={entry} />
      </span>
      <span className="hidden tabular-nums text-muted-foreground md:block">
        {created && !Number.isNaN(created.getTime()) ? date.format(created) : "—"}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={`Más acciones de ${entry.name}`}
          className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted"
        >
          <MoreHorizontal className="size-4" aria-hidden />
          <span className="hidden sm:inline">Más</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem className="min-h-11" onSelect={() => actions.onOpen(entry)}>
            <ExternalLink /> Abrir
          </DropdownMenuItem>
          {entry.kind === "document" ? (
            <DropdownMenuItem className="min-h-11" onSelect={() => actions.onSend(entry)}>
              <Send /> Enviar a firma
            </DropdownMenuItem>
          ) : null}
          {entry.kind !== "document" ? (
            <DropdownMenuItem className="min-h-11" onSelect={() => actions.onRename(entry)}>
              <Pencil /> Cambiar nombre
            </DropdownMenuItem>
          ) : null}
          {canMoveUp ? (
            <DropdownMenuItem className="min-h-11" onSelect={() => actions.onMoveUp(entry)}>
              <ArrowUpFromLine /> Subir un nivel
            </DropdownMenuItem>
          ) : null}
          {entry.kind === "folder" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive className="min-h-11" onSelect={() => actions.onDelete(entry)}>
                <Trash2 /> Eliminar carpeta
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Miga de pan que también recibe elementos arrastrados: soltar sobre ella los mueve a ese nivel. */
export function DropCrumb({
  folderId,
  current,
  onGo,
  children,
}: {
  folderId: string | null;
  current: boolean;
  onGo: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(folderId) });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onGo}
      aria-current={current ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-md px-2.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        current ? "font-semibold text-foreground" : "text-muted-foreground",
        isOver && "bg-accent ring-2 ring-foreground",
      )}
    >
      {children}
    </button>
  );
}
