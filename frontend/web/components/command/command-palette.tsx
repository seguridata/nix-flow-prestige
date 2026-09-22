"use client";

import { useEffect, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { FilePlus2, FileText, GitBranch, Inbox, LayoutDashboard, ListChecks, Send, ShieldCheck, UserPlus } from "lucide-react";
import { apiClient } from "@/services/api-client";

interface SearchHit {
  documents: { id: string; filename: string }[];
  onboarding: { id: string; fullName: string; email: string }[];
  requests: { id: string; documentId: string; status: string; requestedByName: string | null }[];
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit | null>(null);

  useEffect(() => {
    if (!open) return;
    if (query.trim().length < 2) {
      setHits(null);
      return;
    }
    const handle = window.setTimeout(() => {
      apiClient
        .get<SearchHit>(`/operations/search?q=${encodeURIComponent(query.trim())}`)
        .then(setHits)
        .catch(() => setHits(null));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query, open]);

  if (!open) return null;

  function go(path: string) {
    onOpenChange(false);
    setQuery("");
    router.push(path as Route);
  }

  return (
    <div className="fixed inset-0 z-50 bg-brand-carbon/40 backdrop-blur-[2px]" onClick={() => onOpenChange(false)}>
      <Command
        className="glass mx-auto mt-[18vh] w-[min(560px,92vw)] overflow-hidden rounded-lg border border-border shadow-elevated"
        onClick={(e) => e.stopPropagation()}
        shouldFilter={false}
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Buscar documento, persona o ir a…"
          className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          {hits?.documents.map((doc) => (
            <Command.Item
              key={doc.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted"
              onSelect={() => go(`/documents/${doc.id}`)}
            >
              <FileText className="size-4" /> {doc.filename}
            </Command.Item>
          ))}
          {hits?.onboarding.map((row) => (
            <Command.Item
              key={row.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted"
              onSelect={() => go(`/onboarding/${row.id}`)}
            >
              <UserPlus className="size-4" /> {row.fullName}
            </Command.Item>
          ))}
          {hits?.requests.map((row) => (
            <Command.Item
              key={row.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted"
              onSelect={() => go(`/documents/${row.documentId}`)}
            >
              <Send className="size-4" /> {row.requestedByName ?? row.id.slice(0, 8)} · {row.status}
            </Command.Item>
          ))}
          <Command.Item className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted" onSelect={() => go("/overview")}>
            <LayoutDashboard className="size-4" /> Overview
          </Command.Item>
          <Command.Item className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted" onSelect={() => go("/inbox")}>
            <Inbox className="size-4" /> Bandeja
          </Command.Item>
          <Command.Item className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted" onSelect={() => go("/new")}>
            <FilePlus2 className="size-4" /> Nuevo envío
          </Command.Item>
          <Command.Item className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted" onSelect={() => go("/onboarding")}>
            <UserPlus className="size-4" /> Onboarding
          </Command.Item>
          <Command.Item className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted" onSelect={() => go("/tasks")}>
            <ListChecks className="size-4" /> Tareas
          </Command.Item>
          <Command.Item className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted" onSelect={() => go("/process")}>
            <GitBranch className="size-4" /> Proceso BPMN
          </Command.Item>
          <Command.Item className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted" onSelect={() => window.open("http://localhost:8088", "_blank")}>
            <ShieldCheck className="size-4" /> Temporal UI
          </Command.Item>
        </Command.List>
      </Command>
    </div>
  );
}
