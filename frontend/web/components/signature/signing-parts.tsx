"use client";

import { Check, Fingerprint } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/libs/utils";

/* Piezas compartidas por el portal del firmante y la firma interna: mismos pasos, mismo vocabulario. */

export type SigningMethod = "DIGITAL" | "AUTOGRAFA" | "ACCEPT" | "PASSKEY" | "BIOMETRICA";

export const SIGNING_METHOD_TEXT: Record<SigningMethod, { label: string; hint: string }> = {
  ACCEPT: { label: "Acepto", hint: "Confirmas con un toque, sobre el documento original congelado." },
  PASSKEY: { label: "Passkey", hint: "Usa tu huella o el desbloqueo del dispositivo." },
  AUTOGRAFA: { label: "Autógrafa", hint: "Dibuja tu firma con el dedo o el mouse." },
  DIGITAL: { label: "Firma digital", hint: "Certificado emitido por la CA interna de SeguriData." },
  BIOMETRICA: { label: "Biométrica", hint: "Prueba de vida contra el motor de SeguriData." },
};

const UNAVAILABLE_SUBJECT: Record<SigningMethod, string> = {
  AUTOGRAFA: "la autógrafa",
  ACCEPT: "Acepto",
  PASSKEY: "la passkey",
  BIOMETRICA: "la firma biométrica",
  DIGITAL: "la firma digital",
};

/** Por qué un método que el sobre permite ya no se puede usar (se explica, no se contradice con una etiqueta). */
export function unavailableReason(method: SigningMethod): string {
  if (method === "DIGITAL") return "La firma digital no está disponible para este documento.";
  return `Este documento ya tiene firma digital: ${UNAVAILABLE_SUBJECT[method]} ya no puede agregarse.`;
}

/** Revisar → Firmar → Listo. El estado va en forma (palomita, número) y en texto, no solo en color. */
export function SigningSteps({ current, className }: { current: 0 | 1 | 2; className?: string }) {
  const steps = ["Revisar", "Firmar", "Listo"];
  return (
    <ol aria-label="Pasos para firmar" className={cn("flex items-center gap-2", className)}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} aria-current={active ? "step" : undefined} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-xs font-medium",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-foreground bg-foreground text-background",
                !done && !active && "border-border text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("text-sm", active ? "font-medium text-foreground" : "text-muted-foreground")}>
              {label}
              {done ? <span className="sr-only"> (completado)</span> : null}
            </span>
            {i < steps.length - 1 ? <span aria-hidden className="h-px w-5 bg-border sm:w-8" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Opción de método como radio nativo: seleccionar cambia el aro y el punto, no solo el color. Área táctil ≥ 56 px. */
export function MethodOption({
  label,
  hint,
  selected,
  disabled = false,
  onSelect,
  children,
}: {
  label: string;
  hint: string;
  selected: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "relative flex min-h-14 items-start gap-3 rounded-lg border p-4",
        disabled ? "cursor-not-allowed border-border bg-muted/50" : "cursor-pointer",
        !disabled && (selected ? "border-2 border-foreground" : "border-border hover:bg-muted/50"),
      )}
    >
      <input type="radio" name="metodo" className="peer sr-only" checked={selected} disabled={disabled} onChange={onSelect} />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
          selected ? "border-foreground" : "border-border",
        )}
      >
        {selected ? <span className="size-2.5 rounded-full bg-foreground" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-base font-medium", disabled && "text-muted-foreground")}>{label}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
        {children}
      </span>
    </label>
  );
}

/** Consentimiento: siempre empieza sin marcar y la casilla mide 24 px. */
export function ConsentCheck({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border border-border p-4 text-sm leading-snug">
      <input
        type="checkbox"
        className="mt-0.5 size-6 shrink-0 accent-[var(--brand-carbon)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

/** Verificación de passkey: un paso más antes de firmar, con su resultado en texto. */
export function PasskeyStep({
  required,
  verified,
  verifying,
  error,
  onVerify,
}: {
  required: boolean;
  verified: boolean;
  verifying: boolean;
  error?: string | null;
  onVerify: () => void;
}) {
  return (
    <section className="rounded-lg border border-border p-4">
      <p className="text-sm font-medium">
        {required ? "Esta firma exige verificar tu passkey" : "Verifica tu identidad con tu passkey"}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {verified ? "Listo, tu identidad quedó verificada." : "Tu dispositivo te pedirá huella, rostro o PIN."}
      </p>
      <Button
        type="button"
        size="lg"
        className="mt-3 w-full"
        variant={verified ? "outline" : "secondary"}
        disabled={verifying || verified}
        onClick={onVerify}
      >
        {verified ? <Check /> : <Fingerprint />}
        {verified ? "Passkey verificada" : verifying ? "Verificando…" : "Verificar con passkey"}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
