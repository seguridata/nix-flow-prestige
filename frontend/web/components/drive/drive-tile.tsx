"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ArrowUpFromLine, ExternalLink, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";

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

export interface TileActions {
  onOpen: (e: DriveEntry) => void;
  onRename: (e: DriveEntry) => void;
  onDelete: (e: DriveEntry) => void;
  onMoveUp: (e: DriveEntry) => void;
  onSend: (e: DriveEntry) => void;
}

/**
 * Elemento del explorador. Se arrastra (carpetas, expedientes y documentos) y las carpetas
 * reciben lo que se suelta encima. Todo lo que hace el arrastre también está en el menú "⋯".
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
        "group relative flex w-full cursor-default select-none flex-col items-center rounded-lg border border-transparent px-2 pb-3 pt-4 text-center outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-border bg-accent/70 hover:bg-accent/70",
        isOver && "border-2 border-foreground bg-accent",
        isDragging && "opacity-40",
      )}
    >
      {entry.kind === "folder" ? <FolderIcon /> : entry.kind === "case" ? <CaseIcon /> : <DocumentIcon />}
      <span className="mt-2 line-clamp-2 w-full break-words text-sm font-medium leading-snug">{entry.name}</span>
      <span className="mt-0.5 text-xs text-muted-foreground">{entry.detail}</span>

      <DropdownMenu>
        <DropdownMenuTrigger
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Acciones de ${entry.name}`}
          className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground opacity-0 outline-none hover:bg-background focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => actions.onOpen(entry)}>
            <ExternalLink /> Abrir
          </DropdownMenuItem>
          {entry.kind === "document" ? (
            <DropdownMenuItem onSelect={() => actions.onSend(entry)}>
              <Send /> Enviar a firma
            </DropdownMenuItem>
          ) : null}
          {entry.kind !== "document" ? (
            <DropdownMenuItem onSelect={() => actions.onRename(entry)}>
              <Pencil /> Cambiar nombre
            </DropdownMenuItem>
          ) : null}
          {canMoveUp ? (
            <DropdownMenuItem onSelect={() => actions.onMoveUp(entry)}>
              <ArrowUpFromLine /> Subir un nivel
            </DropdownMenuItem>
          ) : null}
          {entry.kind === "folder" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => actions.onDelete(entry)}>
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
        "rounded-md px-2 py-1 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        current ? "font-semibold text-foreground" : "text-muted-foreground",
        isOver && "bg-accent ring-2 ring-foreground",
      )}
    >
      {children}
    </button>
  );
}
