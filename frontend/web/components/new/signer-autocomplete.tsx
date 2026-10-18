"use client";

import { useMemo, useRef, useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { cn } from "@/libs/utils";
import type { Colleague } from "@/libs/types";

/** minúsculas y sin acentos, para comparar "Maria" ~ "María". */
function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

interface SignerAutocompleteProps {
  /** Resultado de `form.register(...)` para este campo. El input sigue editable. */
  register: UseFormRegisterReturn;
  /** Valor actual del campo (`form.watch(...)`), para filtrar. */
  value: string;
  /** Directorio del tenant. Vacío ⇒ el componente es un `<Input>` normal. */
  colleagues: Colleague[];
  /** El usuario eligió una sugerencia: rellena nombre + correo del firmante. */
  onPick: (c: Colleague) => void;
  placeholder?: string;
  "aria-label"?: string;
}

/**
 * Input de texto libre con un desplegable **opcional** de usuarios registrados,
 * al estilo del autocompletado de correo. No bloquea la edición: el usuario
 * puede escribir cualquier cosa; las sugerencias solo aparecen si coinciden.
 */
export function SignerAutocomplete({
  register,
  value,
  colleagues,
  onPick,
  placeholder,
  ...rest
}: SignerAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => {
    const q = norm(value ?? "");
    if (!q || colleagues.length === 0) return [];
    const hits = colleagues.filter((c) =>
      `${norm(c.name ?? "")} ${norm(c.email ?? "")}`.includes(q),
    );
    // Ya hay match exacto por correo → no estorbamos con el desplegable.
    if (hits.length === 1 && norm(hits[0]?.email ?? "") === q) return [];
    return hits.slice(0, 6);
  }, [value, colleagues]);

  const show = open && matches.length > 0;

  function choose(c: Colleague) {
    onPick(c);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        {...rest}
        {...register}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          register.onChange(e);
          setActive(0);
          setOpen(true);
        }}
        onBlur={(e) => {
          register.onBlur(e);
          // Deja que un click en una fila se procese antes de cerrar.
          closeTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const pick = matches[active] ?? matches[0];
            if (pick) choose(pick);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />

      {show && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.map((c, i) => (
            <li
              key={c.userId}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                // mousedown (no click) para ganarle al blur del input.
                e.preventDefault();
                choose(c);
              }}
              className={cn(
                "cursor-pointer rounded-sm px-2.5 py-1.5",
                i === active ? "bg-accent text-accent-foreground" : "",
              )}
            >
              <span className="block text-sm font-medium">{c.name ?? c.userId}</span>
              {c.email ? (
                <span className="block text-xs text-muted-foreground">{c.email}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
