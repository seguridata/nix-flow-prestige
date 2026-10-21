"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { shortHash } from "@/libs/envelope-status";
import { cn } from "@/libs/utils";

/**
 * Hash en mono, truncado con «…» y con botón «Copiar» que copia el valor completo.
 * El estado "copiado" se dice en texto, no solo con el icono.
 */
export function HashChip({
  value,
  label,
  head = 8,
  tail = 4,
  className,
}: {
  value: string;
  /** Para lectores de pantalla: qué hash es (p. ej. "SHA-256 del original"). */
  label?: string;
  head?: number;
  tail?: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* El portapapeles puede estar bloqueado: el valor completo sigue en el atributo title. */
    }
  }

  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md bg-muted py-0.5 pl-2 pr-0.5", className)}>
      <code className="truncate font-mono text-xs tabular-nums text-foreground/80" title={value}>
        {shortHash(value, head, tail)}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={label ? `Copiar ${label}` : "Copiar hash completo"}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        <span aria-live="polite">{copied ? "Copiado" : "Copiar"}</span>
      </button>
    </span>
  );
}
