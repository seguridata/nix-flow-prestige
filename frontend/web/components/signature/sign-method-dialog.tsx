"use client";

import { useState } from "react";
import { CheckCircle2, Fingerprint, KeyRound, PenTool, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AutographPad } from "@/components/signature/autograph-pad";
import { cn } from "@/libs/utils";
import type { SignatureMethod } from "@/libs/types";

const METHOD_INFO: Record<
  SignatureMethod,
  { label: string; description: string; icon: typeof Fingerprint }
> = {
  BIOMETRICA: {
    label: "Biométrica",
    description: "Prueba de vida contra el motor de SeguriData (pendiente de proveedor).",
    icon: Fingerprint,
  },
  AUTOGRAFA: {
    label: "Autógrafa",
    description: "Dibuja tu firma. El trazo se incrusta en el PDF y en el manifiesto.",
    icon: PenTool,
  },
  DIGITAL: {
    label: "Digital",
    description: "Certificado PAdES emitido por la CA interna, hasta conectar el HSM.",
    icon: ShieldCheck,
  },
  PASSKEY: {
    label: "Passkey",
    description: "Verificas tu identidad con la passkey de tu dispositivo.",
    icon: KeyRound,
  },
  ACCEPT: {
    label: "Acepto",
    description: "Confirmas sobre el hash congelado. Sin trazo ni certificado.",
    icon: CheckCircle2,
  },
};

interface SignMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowedMethods: SignatureMethod[];
  consentText?: { version: string; text: string };
  biometricReady?: boolean;
  /** El sobre exige passkey para cualquier método. */
  requirePasskey?: boolean;
  /** Ejecuta la ceremonia passkey interna y devuelve el assertionId verificado. */
  onVerifyPasskey?: () => Promise<string>;
  onConfirm: (payload: {
    method: SignatureMethod;
    autograph?: Blob;
    consentAccepted: boolean;
    passkeyAssertionId?: string;
  }) => void;
  isSubmitting?: boolean;
}

export function SignMethodDialog({
  open,
  onOpenChange,
  allowedMethods,
  consentText,
  biometricReady = false,
  requirePasskey = false,
  onVerifyPasskey,
  onConfirm,
  isSubmitting,
}: SignMethodDialogProps) {
  const [selected, setSelected] = useState<SignatureMethod | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [stroke, setStroke] = useState<Blob | null>(null);
  const [assertionId, setAssertionId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  // Reinicia la ceremonia al abrir (o si cambian los métodos permitidos) derivando
  // durante el render en lugar de setState dentro de un efecto.
  const [prevKey, setPrevKey] = useState<{ open: boolean; methods: SignatureMethod[] | null }>({
    open: false,
    methods: null,
  });
  if (prevKey.open !== open || prevKey.methods !== allowedMethods) {
    setPrevKey({ open, methods: allowedMethods });
    if (open) {
      setStroke(null);
      setAccepted(false);
      setAssertionId(null);
      setPasskeyError(null);
      setSelected(allowedMethods.includes("AUTOGRAFA") ? "AUTOGRAFA" : (allowedMethods[0] ?? null));
    }
  }

  const blocked = selected === "BIOMETRICA" && !biometricReady;
  const needsStroke = selected === "AUTOGRAFA";
  const needsPasskey = requirePasskey || selected === "PASSKEY";
  const passkeyBlocked = needsPasskey && !assertionId;

  async function verifyPasskey() {
    if (!onVerifyPasskey) return;
    setVerifying(true);
    setPasskeyError(null);
    try {
      setAssertionId(await onVerifyPasskey());
    } catch (e) {
      setPasskeyError(e instanceof Error ? e.message : "No se pudo verificar la passkey.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ceremonia de firma</DialogTitle>
          <DialogDescription>
            Consentimiento versionado, método y —si aplica— trazo autógrafo. Nada se simula.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {allowedMethods.map((method) => {
            const info = METHOD_INFO[method];
            const Icon = info.icon;
            const isSelected = selected === method;
            return (
              <button
                key={method}
                type="button"
                onClick={() => setSelected(method)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-md border p-5 text-center transition-transform duration-150 active:scale-[0.97]",
                  isSelected ? "border-primary bg-accent" : "border-border hover:bg-muted",
                )}
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-muted">
                  <Icon className="size-5 text-primary" strokeWidth={1.75} />
                </span>
                <span className="text-sm font-semibold text-foreground">{info.label}</span>
                <span className="text-xs leading-snug text-muted-foreground">{info.description}</span>
              </button>
            );
          })}
        </div>

        {needsStroke ? <AutographPad onChange={setStroke} /> : null}

        {consentText ? (
          <label className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              <span className="font-medium">Acepto el consentimiento v{consentText.version}.</span>
              <span className="mt-1 block whitespace-pre-line text-xs text-muted-foreground">
                {consentText.text}
              </span>
            </span>
          </label>
        ) : null}

        {needsPasskey ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {requirePasskey ? "Esta firma exige verificación con passkey" : "Verifica con tu passkey"}
            </p>
            {onVerifyPasskey ? (
              <Button
                type="button"
                size="sm"
                className="mt-2"
                variant={assertionId ? "outline" : "default"}
                disabled={verifying || Boolean(assertionId)}
                onClick={verifyPasskey}
              >
                {assertionId ? "Passkey verificada ✓" : verifying ? "Verificando…" : "Verificar con passkey"}
              </Button>
            ) : (
              <p className="mt-1 text-xs text-warning">
                La verificación con passkey no está disponible en este entorno. Contacta a quien envió el
                documento.
              </p>
            )}
            {passkeyError ? <p className="mt-1 text-xs text-destructive">{passkeyError}</p> : null}
          </div>
        ) : null}

        {blocked ? (
          <p className="text-xs text-warning">
            El entorno biométrico está listo. Falta BIOMETRIC_PROVIDER_URL del proveedor.
          </p>
        ) : null}

        <Button
          size="lg"
          disabled={!selected || !accepted || isSubmitting || blocked || passkeyBlocked || (needsStroke && !stroke)}
          onClick={() =>
            selected &&
            onConfirm({
              method: selected,
              autograph: stroke ?? undefined,
              consentAccepted: accepted,
              passkeyAssertionId: assertionId ?? undefined,
            })
          }
        >
          {isSubmitting ? "Firmando…" : "Confirmar y firmar"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
