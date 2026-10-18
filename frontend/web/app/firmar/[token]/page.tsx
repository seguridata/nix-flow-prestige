"use client";

import { use, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { startAuthentication } from "@simplewebauthn/browser";
import { CircleCheck, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AutographPad } from "@/components/signature/autograph-pad";
import { splitMethods } from "@/libs/allowed-methods";
import { cn } from "@/libs/utils";
import {
  acceptPublicConsent,
  beginPasskey,
  finishPasskey,
  PublicLinkError,
  rejectPublicLink,
  resolvePublicLink,
  signPublicLink,
  type PublicLinkContext,
} from "@/services/public-sign-service";

/** Mensajes en español por código HTTP del portal público. */
function publicErrorMessage(e: Error): string {
  const status = e instanceof PublicLinkError ? e.status : 0;
  if (status === 410) return "Este enlace ya se utilizó o expiró. Solicita uno nuevo al remitente.";
  if (status === 409) return "Ya firmaste esta solicitud, por lo que no puede rechazarse.";
  if (status === 502 || status === 503 || status === 504) {
    return "Servicio no disponible por el momento. Intenta de nuevo en unos minutos.";
  }
  return e.message || "No se pudo completar la operación.";
}

type Method = "DIGITAL" | "AUTOGRAFA" | "ACCEPT" | "PASSKEY";

export default function FirmarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [consent, setConsent] = useState(false);
  const [method, setMethod] = useState<Method | null>(null);
  const [stroke, setStroke] = useState<Blob | null>(null);
  const [assertionId, setAssertionId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const link = useQuery({
    queryKey: ["public-link", token],
    queryFn: () => resolvePublicLink(token),
    retry: false,
  });

  const verifyPasskey = useMutation({
    mutationFn: async () => {
      const { assertionId: id, options } = await beginPasskey(token);
      const response = await startAuthentication({ optionsJSON: options });
      await finishPasskey(token, id, response);
      return id;
    },
    onSuccess: (id) => {
      setAssertionId(id);
      toast.success("Passkey verificada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sign = useMutation({
    mutationFn: async () => {
      // Registra la prueba de consentimiento (IP/UA los toma el servidor) antes de firmar.
      await acceptPublicConsent(token);
      return signPublicLink(
        token,
        { method: method!, consentAccepted: consent, passkeyAssertionId: assertionId ?? undefined },
        method === "AUTOGRAFA" ? stroke ?? undefined : undefined,
      );
    },
    onSuccess: () => {
      setDone(true);
      toast.success("Firma aplicada.");
    },
    onError: (e: Error) => toast.error(publicErrorMessage(e)),
  });

  const reject = useMutation({
    mutationFn: () => rejectPublicLink(token, reason),
    onSuccess: () => {
      setRejectOpen(false);
      setRejected(true);
    },
    onError: (e: Error) => toast.error(publicErrorMessage(e)),
  });

  const needsPasskey = Boolean(link.data?.requirePasskey) || method === "PASSKEY";
  const passkeySatisfied = !needsPasskey || Boolean(assertionId);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-5">
      <header className="mb-8 flex items-center gap-2.5 border-b border-border pb-4">
        <img src="/brand/seguridata-logo.png" alt="" className="size-8 rounded-md object-contain" width={32} height={32} />
        <span className="flex flex-col leading-none">
          <span className="text-[17px] font-semibold tracking-tight">Prestige</span>
          <span className="mt-0.5 text-xs text-muted-foreground">por SeguriData</span>
        </span>
      </header>

      {link.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Validando el enlace…
        </p>
      ) : link.isError ? (
        <Outcome
          icon={<CircleX className="size-6" aria-hidden />}
          title="Este enlace no es válido"
          body={`${(link.error as Error).message} Pide al remitente que te envíe un enlace nuevo.`}
        />
      ) : rejected || link.data?.myStatus === "RECHAZADO" ? (
        <Outcome
          icon={<CircleX className="size-6" aria-hidden />}
          title="Rechazaste este documento"
          body="Se avisó al remitente y el enlace ya no puede usarse. Puedes cerrar esta ventana."
        />
      ) : done || link.data?.myStatus === "FIRMADO" ? (
        <Outcome
          icon={<CircleCheck className="size-6" aria-hidden />}
          title="Firma registrada"
          body="Tu firma quedó en el expediente de evidencia de Prestige. Puedes cerrar esta ventana."
        />
      ) : (
        <FirmarForm
          ctx={link.data!}
          consent={consent}
          setConsent={setConsent}
          method={method}
          setMethod={setMethod}
          setStroke={setStroke}
          onVerifyPasskey={() => verifyPasskey.mutate()}
          verifyingPasskey={verifyPasskey.isPending}
          passkeyVerified={Boolean(assertionId)}
          needsPasskey={needsPasskey}
          canSubmit={
            consent &&
            !!method &&
            (method !== "AUTOGRAFA" || !!stroke) &&
            passkeySatisfied &&
            !sign.isPending
          }
          hasStroke={!!stroke}
          onSubmit={() => sign.mutate()}
          pending={sign.isPending}
          onReject={() => setRejectOpen(true)}
        />
      )}

      <Dialog open={rejectOpen} onOpenChange={(o) => !reject.isPending && setRejectOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Rechazar este documento?</DialogTitle>
            <DialogDescription>
              Esta acción es definitiva: se notificará al remitente y el enlace dejará de funcionar.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor="reject-reason" className="text-sm font-medium">
            Motivo (opcional)
          </label>
          <textarea
            id="reject-reason"
            className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-right text-xs text-muted-foreground">{reason.length}/500</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={reject.isPending} onClick={() => setRejectOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={reject.isPending} onClick={() => reject.mutate()}>
              {reject.isPending ? "Rechazando…" : "Rechazar documento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Outcome({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <section role="status" className="space-y-3">
      <span className="text-foreground">{icon}</span>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </section>
  );
}

const METHOD_TEXT: Record<Method, { label: string; hint: string }> = {
  ACCEPT: { label: "Acepto", hint: "Confirmas con un toque, sobre el documento original congelado." },
  PASSKEY: { label: "Passkey", hint: "Usa tu huella o el desbloqueo del teléfono." },
  AUTOGRAFA: { label: "Autógrafa", hint: "Dibuja tu firma con el dedo." },
  DIGITAL: { label: "Firma digital", hint: "Certificado emitido por la CA interna de SeguriData." },
};
const METHOD_ORDER: Method[] = ["ACCEPT", "PASSKEY", "AUTOGRAFA", "DIGITAL"];
const isMethod = (m: string): m is Method => m in METHOD_TEXT;
const byOrder = (a: Method, b: Method) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b);

function FirmarForm({
  ctx,
  consent,
  setConsent,
  method,
  setMethod,
  setStroke,
  hasStroke,
  onVerifyPasskey,
  verifyingPasskey,
  passkeyVerified,
  needsPasskey,
  canSubmit,
  onSubmit,
  pending,
  onReject,
}: {
  ctx: PublicLinkContext;
  consent: boolean;
  setConsent: (v: boolean) => void;
  method: Method | null;
  setMethod: (m: Method) => void;
  setStroke: (b: Blob | null) => void;
  hasStroke: boolean;
  onVerifyPasskey: () => void;
  verifyingPasskey: boolean;
  passkeyVerified: boolean;
  needsPasskey: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  pending: boolean;
  onReject: () => void;
}) {
  const base = (ctx.methods.length ? ctx.methods : ["DIGITAL"]).filter(isMethod);
  const split = splitMethods(base, ctx.allowedMethodsNow?.filter(isMethod));
  const usable = split.usable.sort(byOrder);
  const unavailable = split.unavailable.sort(byOrder);

  const expires = ctx.expiresAt
    ? new Date(ctx.expiresAt).toLocaleDateString("es-MX", { day: "numeric", month: "long" })
    : null;

  // Lo que falta para poder firmar, dicho en una frase (el botón solo está apagado por esto).
  const missing = !consent
    ? "Marca el consentimiento para continuar."
    : !method
      ? "Elige cómo firmar."
      : needsPasskey && !passkeyVerified
        ? "Verifica tu passkey para continuar."
        : method === "AUTOGRAFA" && !hasStroke
          ? "Dibuja tu firma para continuar."
          : null;

  return (
    <div className="space-y-7">
      <section>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          {ctx.requestedByName ? `${ctx.requestedByName} te pidió firmar` : "Te pidieron firmar"}
        </h1>
        <div className="mt-4 rounded-lg border border-border bg-muted/50 p-4">
          <p className="text-base font-medium">{ctx.documentTitle ?? "Documento por firmar"}</p>
          {ctx.signerName ? <p className="mt-1 text-sm text-muted-foreground">Firmas como {ctx.signerName}</p> : null}
          <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
            El documento original quedó congelado: tu firma se registra sobre su huella y cualquier cambio posterior se
            detecta.
          </p>
        </div>
      </section>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 text-sm leading-snug">
        <input
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-[var(--brand-carbon)]"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          Acepto firmar electrónicamente este documento y que se registren la fecha, la hora y los datos técnicos de mi
          firma como evidencia.
        </span>
      </label>

      <fieldset>
        <legend className="mb-3 text-lg font-semibold">Elige cómo firmar</legend>
        <div className="space-y-2.5">
          {usable.map((m) => (
            <MethodOption key={m} selected={method === m} onSelect={() => setMethod(m)} {...METHOD_TEXT[m]}>
              {m === "AUTOGRAFA" && method === "AUTOGRAFA" ? (
                <div className="mt-3 h-40 overflow-hidden rounded-md border border-border bg-background">
                  <AutographPad onChange={setStroke} />
                </div>
              ) : null}
            </MethodOption>
          ))}
          {unavailable.map((m) => (
            <MethodOption
              key={m}
              disabled
              selected={false}
              label={METHOD_TEXT[m].label}
              hint="No disponible: este documento ya tiene firma digital."
            />
          ))}
        </div>
      </fieldset>

      {needsPasskey ? (
        <section className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">
            {ctx.requirePasskey ? "Esta firma exige verificar tu passkey" : "Verifica tu identidad con tu passkey"}
          </p>
          <Button
            type="button"
            className="mt-3 w-full"
            variant={passkeyVerified ? "outline" : "default"}
            disabled={verifyingPasskey || passkeyVerified}
            onClick={onVerifyPasskey}
          >
            {passkeyVerified ? "Passkey verificada" : verifyingPasskey ? "Verificando…" : "Verificar con passkey"}
          </Button>
        </section>
      ) : null}

      <div className="space-y-3">
        <Button size="lg" className="w-full" disabled={!canSubmit} onClick={onSubmit}>
          {pending ? "Firmando…" : method ? `Firmar con ${METHOD_TEXT[method].label}` : "Firmar documento"}
        </Button>
        {missing && !pending ? (
          <p className="text-center text-sm text-muted-foreground" role="status">
            {missing}
          </p>
        ) : null}
        <Button type="button" variant="ghost" className="w-full text-muted-foreground" disabled={pending} onClick={onReject}>
          Rechazar este documento
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Este enlace es de un solo uso{expires ? ` · vence el ${expires}` : ""}
      </p>
    </div>
  );
}

/** Opción de método como radio nativo: el estado seleccionado cambia el aro y el punto, no solo el color. */
function MethodOption({
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
        "relative flex items-start gap-3 rounded-lg border p-4",
        disabled ? "cursor-not-allowed border-border bg-muted/50" : "cursor-pointer",
        !disabled && (selected ? "border-2 border-foreground" : "border-border"),
      )}
    >
      <input
        type="radio"
        name="metodo"
        className="peer sr-only"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
      />
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
