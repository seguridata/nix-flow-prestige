"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { Colleague } from "@/libs/types";
import { cn } from "@/libs/utils";
import { fetchColleagues } from "@/services/directory-service";

export interface Person {
  signerId: string;
  name?: string;
  email?: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * Elige a una persona del directorio del tenant. Si el directorio no responde, deja escribir el
 * correo a mano: el firmante se identifica por su correo igual que en el envío normal.
 */
export function PersonPicker({
  value,
  onChange,
  label = "Persona",
}: {
  value: Person | null;
  onChange: (p: Person | null) => void;
  label?: string;
}) {
  const { data: colleagues = [] } = useQuery({ queryKey: ["colleagues"], queryFn: fetchColleagues, staleTime: 60_000 });
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = norm(text);
    if (!q) return colleagues.slice(0, 6);
    return colleagues.filter((c) => `${norm(c.name ?? "")} ${norm(c.email ?? "")}`.includes(q)).slice(0, 6);
  }, [text, colleagues]);

  const pick = (c: Colleague) => {
    onChange({ signerId: c.email ?? c.userId, name: c.name ?? undefined, email: c.email ?? undefined });
    setText("");
    setOpen(false);
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
        <Check className="size-4 shrink-0 text-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{value.name || value.signerId}</span>
          {value.email && value.name ? <span className="text-muted-foreground"> · {value.email}</span> : null}
        </span>
        <button type="button" aria-label={`Quitar a ${value.name || value.signerId}`} onClick={() => onChange(null)} className="rounded p-1 text-muted-foreground hover:bg-background">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const looksLikeEmail = /^\S+@\S+\.\S+$/.test(text.trim());

  return (
    <div className="relative">
      <Input
        aria-label={label}
        placeholder="Busca por nombre o escribe un correo"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && (matches.length > 0 || looksLikeEmail) ? (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {matches.map((c) => (
            <li key={c.userId} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={cn("flex w-full flex-col rounded px-2.5 py-1.5 text-left text-sm hover:bg-muted")}
              >
                <span className="font-medium">{c.name ?? c.email ?? c.userId}</span>
                {c.email ? <span className="text-xs text-muted-foreground">{c.email}</span> : null}
              </button>
            </li>
          ))}
          {looksLikeEmail && !matches.some((c) => norm(c.email ?? "") === norm(text)) ? (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ signerId: text.trim(), email: text.trim() });
                  setText("");
                  setOpen(false);
                }}
                className="w-full rounded px-2.5 py-1.5 text-left text-sm hover:bg-muted"
              >
                Usar «{text.trim()}»
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
