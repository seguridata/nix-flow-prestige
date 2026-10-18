import { useId } from "react";

import { cn } from "@/libs/utils";

/**
 * Iconos del explorador, al estilo de Windows 11: volumen suave y paleta propia por tipo.
 * El color es decorativo: el tipo siempre se dice también con texto (nombre y detalle).
 *  - Carpeta: amarillo clásico del explorador.
 *  - Expediente: carpeta verde SeguriData con hojas asomando.
 *  - Documento: hoja blanca con la etiqueta del formato.
 */
export function FolderIcon({ className }: { className?: string }) {
  const g = useId();
  return (
    <svg viewBox="0 0 64 64" className={cn("size-16", className)} aria-hidden>
      <defs>
        <linearGradient id={`${g}-f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd966" />
          <stop offset="1" stopColor="#f5b52e" />
        </linearGradient>
      </defs>
      <path d="M6 14a4 4 0 0 1 4-4h14l6 6h24a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4Z" fill="#e0a21f" />
      <rect x="6" y="22" width="52" height="32" rx="4" fill={`url(#${g}-f)`} />
      <rect x="6" y="22" width="52" height="3" rx="1.5" fill="#fff" opacity=".35" />
    </svg>
  );
}

export function CaseIcon({ className }: { className?: string }) {
  const g = useId();
  return (
    <svg viewBox="0 0 64 64" className={cn("size-16", className)} aria-hidden>
      <defs>
        <linearGradient id={`${g}-c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9bd11a" />
          <stop offset="1" stopColor="#6a9900" />
        </linearGradient>
      </defs>
      <path d="M6 14a4 4 0 0 1 4-4h14l6 6h24a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4Z" fill="#5a8200" />
      <rect x="13" y="17" width="36" height="26" rx="2.5" fill="#fff" transform="rotate(-4 31 30)" />
      <rect x="15" y="15" width="36" height="26" rx="2.5" fill="#f3f3f3" stroke="#d6d6d6" />
      <path d="M21 23h24M21 28h24M21 33h15" stroke="#9aa3a9" strokeWidth="2" strokeLinecap="round" />
      <rect x="6" y="28" width="52" height="26" rx="4" fill={`url(#${g}-c)`} />
      <rect x="6" y="28" width="52" height="3" rx="1.5" fill="#fff" opacity=".3" />
      <circle cx="48" cy="44" r="5" fill="#191919" />
      <path d="m45.6 44 1.8 1.8 3-3.4" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DocumentIcon({ label = "PDF", className }: { label?: string; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-16", className)} aria-hidden>
      <path d="M14 6a4 4 0 0 1 4-4h20l14 14v42a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4Z" fill="#fff" stroke="#cfd4d8" strokeWidth="1.5" />
      <path d="M38 2v10a4 4 0 0 0 4 4h10Z" fill="#e6e9ec" stroke="#cfd4d8" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M21 26h22M21 32h22M21 38h14" stroke="#b9c0c5" strokeWidth="2" strokeLinecap="round" />
      <rect x="9" y="44" width="30" height="13" rx="3" fill="#191919" />
      <text x="24" y="54" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#fff" fontFamily="DM Sans, sans-serif">
        {label}
      </text>
    </svg>
  );
}
