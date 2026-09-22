"use client";

import { use, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AutographPad } from "@/components/signature/autograph-pad";
import {
  resolvePublicLink,
  signPublicLink,
  type PublicLinkContext,
} from "@/services/public-sign-service";

type Method = "DIGITAL" | "AUTOGRAFA";

export default function FirmarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [consent, setConsent] = useState(false);
  const [method, setMethod] = useState<Method | null>(null);
  const [stroke, setStroke] = useState<Blob | null>(null);
  const [done, setDone] = useState(false);

  const link = useQuery({
    queryKey: ["public-link", token],
    queryFn: () => resolvePublicLink(token),
    retry: false,
  });

  const sign = useMutation({
    mutationFn: () =>
      signPublicLink(
        token,
        { method: method!, consentAccepted: consent },
        method === "AUTOGRAFA" ? stroke ?? undefined : undefined,
      ),
    onSuccess: () => {
      setDone(true);
      toast.success("Firma aplicada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-baseline gap-2">
        <span className="text-lg font-bold tracking-wide">PRESTIGE</span>
        <span className="text-sm text-muted-foreground">· Portal de firma</span>
      </div>

      {link.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Validando el enlace…</Card>
      ) : link.isError ? (
        <Card className="p-6">
          <h1 className="text-lg font-semibold">Enlace no válido</h1>
          <p className="mt-2 text-sm text-muted-foreground">{(link.error as Error).message}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Solicita al remitente que te reenvíe un enlace nuevo.
          </p>
        </Card>
      ) : done || link.data?.myStatus === "FIRMADO" ? (
        <Card className="p-6">
          <h1 className="text-lg font-semibold">Firma completada</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Gracias. Tu firma quedó registrada en el expediente de evidencia de Prestige.
          </p>
        </Card>
      ) : (
        <FirmarForm
          ctx={link.data!}
          consent={consent}
          setConsent={setConsent}
          method={method}
          setMethod={setMethod}
          setStroke={setStroke}
          canSubmit={consent && !!method && (method !== "AUTOGRAFA" || !!stroke) && !sign.isPending}
          onSubmit={() => sign.mutate()}
          pending={sign.isPending}
        />
      )}
    </main>
  );
}

function FirmarForm({
  ctx,
  consent,
  setConsent,
  method,
  setMethod,
  setStroke,
  canSubmit,
  onSubmit,
  pending,
}: {
  ctx: PublicLinkContext;
  consent: boolean;
  setConsent: (v: boolean) => void;
  method: Method | null;
  setMethod: (m: Method) => void;
  setStroke: (b: Blob | null) => void;
  canSubmit: boolean;
  onSubmit: () => void;
  pending: boolean;
}) {
  const methods = (ctx.methods.length ? ctx.methods : ["DIGITAL"]).filter(
    (m): m is Method => m === "DIGITAL" || m === "AUTOGRAFA",
  );
  return (
    <Card className="space-y-5 p-6">
      <div>
        <h1 className="text-lg font-semibold">{ctx.documentTitle ?? "Documento por firmar"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ctx.requestedByName ? `${ctx.requestedByName} te ` : "Se te "}envió este documento para tu
          firma electrónica{ctx.signerName ? `, ${ctx.signerName}` : ""}.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          Acepto firmar electrónicamente este documento y que se registren la fecha, hora y datos
          técnicos de mi firma como evidencia (consentimiento versionado).
        </span>
      </label>

      <div>
        <p className="mb-2 text-sm font-medium">Método de firma</p>
        <div className="flex flex-wrap gap-2">
          {methods.map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={method === m ? "default" : "outline"}
              onClick={() => setMethod(m)}
            >
              {m === "DIGITAL" ? "Firma digital (PAdES)" : "Firma autógrafa"}
            </Button>
          ))}
        </div>
      </div>

      {method === "AUTOGRAFA" ? (
        <div>
          <p className="mb-2 text-sm font-medium">Traza tu firma</p>
          <div className="h-40 rounded-md border border-border">
            <AutographPad onChange={setStroke} />
          </div>
        </div>
      ) : null}

      <Button className="w-full" disabled={!canSubmit} onClick={onSubmit}>
        {pending ? "Firmando…" : "Firmar documento"}
      </Button>
    </Card>
  );
}
