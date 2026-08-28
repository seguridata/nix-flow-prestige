"use client";

import { useEffect, useState } from "react";
import { Fingerprint, PenTool, ShieldCheck } from "lucide-react";

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
    description: "Certificado / HSM. Hoy HMAC interno hasta conectar el PKI.",
    icon: ShieldCheck,
  },
};

interface SignMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowedMethods: SignatureMethod[];
  consentText?: { version: string; text: string };
  biometricReady?: boolean;
  onConfirm: (payload: {
    method: SignatureMethod;
    signatureImageBase64?: string;
    consentAccepted: boolean;
  }) => void;
  isSubmitting?: boolean;
}

export function SignMethodDialog({
  open,
  onOpenChange,
  allowedMethods,
  consentText,
  biometricReady = false,
  onConfirm,
  isSubmitting,
}: SignMethodDialogProps) {
  const [selected, setSelected] = useState<SignatureMethod | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [stroke, setStroke] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStroke(null);
    setAccepted(false);
    if (allowedMethods.includes("AUTOGRAFA")) {
      setSelected("AUTOGRAFA");
    } else {
      setSelected(allowedMethods[0] ?? null);
    }
  }, [open, allowedMethods]);

  const blocked = selected === "BIOMETRICA" && !biometricReady;
  const needsStroke = selected === "AUTOGRAFA";

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

        {blocked ? (
          <p className="text-xs text-warning">
            El entorno biométrico está listo. Falta BIOMETRIC_PROVIDER_URL del proveedor.
          </p>
        ) : null}

        <Button
          size="lg"
          disabled={!selected || !accepted || isSubmitting || blocked || (needsStroke && !stroke)}
          onClick={() =>
            selected &&
            onConfirm({
              method: selected,
              signatureImageBase64: stroke ?? undefined,
              consentAccepted: accepted,
            })
          }
        >
          {isSubmitting ? "Firmando…" : "Confirmar y firmar"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
