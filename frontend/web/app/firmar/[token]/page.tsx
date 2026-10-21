"use client";

import { use, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { startAuthentication } from "@simplewebauthn/browser";
import { CircleCheck, CircleX, Clock, FileText, Link2Off, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { AutographPad } from "@/components/signature/autograph-pad";
import {
  ConsentCheck,
  MethodOption,
  PasskeyStep,
  SIGNING_METHOD_TEXT,
  SigningSteps,
  unavailableReason,
  type SigningMethod,
} from "@/components/signature/signing-parts";
import { splitMethods } from "@/libs/allowed-methods";
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

type Method = Exclude<SigningMethod, "BIOMETRICA">;
const METHOD_ORDER: Method[] = ["ACCEPT", "PASSKEY", "AUTOGRAFA", "DIGITAL"];
const isMethod = (m: string): m is Method => METHOD_ORDER.includes(m as Method);
const byOrder = (a: Method, b: Method) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b);

function splitFor(ctx: PublicLinkContext) {
  const base = (ctx.methods.length ? ctx.methods : ["DIGITAL"]).filter(isMethod);
  const split = splitMethods(base, ctx.allowedMethodsNow?.filter(isMethod));
  return { usable: [...split.usable].sort(byOrder), unavailable: [...split.unavailable].sort(byOrder) };
}

export default function FirmarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [step, setStep] = useState<"revisar" | "firmar">("revisar");
  const [consent, setConsent] = useState(false);
  const [pickedMethod, setMethod] = useState<Method | null>(null);
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

  const usable = link.data ? splitFor(link.data).usable : [];
  // Con un solo método posible no hay nada que elegir: queda seleccionado.
  const method = pickedMethod ?? (usable.length === 1 ? (usable[0] ?? null) : null);

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

  const requestStatus = link.data?.status ?? null;
  const signedAlready = done || link.data?.myStatus === "FIRMADO";
  const rejectedAlready = rejected || link.data?.myStatus === "RECHAZADO";

  let body: React.ReactNode;
  let stepIndex: 0 | 1 | 2 = step === "revisar" ? 0 : 1;

  if (link.isLoading) {
    body = (
      <p className="text-sm text-muted-foreground" role="status">
        Validando el enlace…
      </p>
    );
  } else if (link.isError) {
    const status = link.error instanceof PublicLinkError ? link.error.status : 0;
    if (status === 410) {
      body = (
        <Outcome
          icon={<Clock className="size-6" aria-hidden />}
          title="Este enlace ya no está disponible"
          body="Los enlaces de firma son de un solo uso y vencen. Este ya se usó o llegó a su fecha límite."
          next="Pide al remitente que te envíe un enlace nuevo."
        />
      );
    } else if (status === 404) {
      body = (
        <Outcome
          icon={<Link2Off className="size-6" aria-hidden />}
          title="No encontramos este enlace"
          body="Puede que esté incompleto o que se haya copiado mal."
          next="Abre de nuevo el enlace desde el correo original o pide uno nuevo al remitente."
        />
      );
    } else if (status >= 500 || status === 0) {
      body = (
        <Outcome
          icon={<WifiOff className="size-6" aria-hidden />}
          title="No pudimos cargar el documento"
          body="Hubo un problema de conexión o el servicio no está disponible por el momento."
          next="Tu enlace sigue vigente. Intenta de nuevo en unos minutos."
          action={
            <Button size="lg" className="w-full sm:w-auto" onClick={() => link.refetch()}>
              Reintentar
            </Button>
          }
        />
      );
    } else {
      body = (
        <Outcome
          icon={<CircleX className="size-6" aria-hidden />}
          title="Este enlace no es válido"
          body={(link.error as Error).message}
          next="Pide al remitente que te envíe un enlace nuevo."
        />
      );
    }
    stepIndex = 0;
  } else if (rejectedAlready) {
    stepIndex = 2;
    body = (
      <Outcome
        icon={<CircleX className="size-6" aria-hidden />}
        title="Rechazaste este documento"
        body="Se avisó al remitente y el enlace ya no puede usarse."
        next="No tienes que hacer nada más. Puedes cerrar esta ventana."
      />
    );
  } else if (signedAlready) {
    stepIndex = 2;
    body = (
      <Outcome
        icon={<CircleCheck className="size-6" aria-hidden />}
        title="Firma registrada"
        body="Tu firma quedó en el expediente de evidencia de Prestige, con fecha y hora."
        next="No tienes que hacer nada más. Puedes cerrar esta ventana."
      />
    );
  } else if (requestStatus === "EXPIRADA" || requestStatus === "CANCELADA" || requestStatus === "RECHAZADA") {
    const text = {
      EXPIRADA: { title: "Esta solicitud venció", body: "Llegó a su fecha límite sin completarse." },
      CANCELADA: { title: "El remitente canceló esta solicitud", body: "Ya no es necesario que firmes." },
      RECHAZADA: { title: "Esta solicitud fue rechazada", body: "Otra persona rechazó el documento, por eso ya no se puede firmar." },
    }[requestStatus];
    stepIndex = 0;
    body = (
      <Outcome
        icon={<CircleX className="size-6" aria-hidden />}
        title={text.title}
        body={text.body}
        next="Si aún necesitas firmarlo, pide al remitente que envíe una solicitud nueva."
      />
    );
  } else {
    const ctx = link.data!;
    const { unavailable } = splitFor(ctx);
    const canSubmit =
      consent && !!method && (method !== "AUTOGRAFA" || !!stroke) && passkeySatisfied && !sign.isPending;
    body =
      step === "revisar" ? (
        <ReviewStep ctx={ctx} onContinue={() => setStep("firmar")} onReject={() => setRejectOpen(true)} />
      ) : (
        <SignStep
          ctx={ctx}
          usable={usable}
          unavailable={unavailable}
          consent={consent}
          setConsent={setConsent}
          method={method}
          setMethod={setMethod}
          setStroke={setStroke}
          hasStroke={!!stroke}
          needsPasskey={needsPasskey}
          passkeyVerified={Boolean(assertionId)}
          verifyingPasskey={verifyPasskey.isPending}
          onVerifyPasskey={() => verifyPasskey.mutate()}
          canSubmit={canSubmit}
          pending={sign.isPending}
          onSubmit={() => sign.mutate()}
          onBack={() => setStep("revisar")}
          onReject={() => setRejectOpen(true)}
        />
      );
  }

  const showSteps = !link.isLoading && !link.isError;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-10 pt-5">
      <header className="mb-6 flex items-center gap-2.5 border-b border-border pb-4">
        <img src="/brand/seguridata-logo.png" alt="" className="size-8 rounded-md object-contain" width={32} height={32} />
        <span className="flex flex-col leading-none">
          <span className="text-[17px] font-semibold tracking-tight">Prestige</span>
          <span className="mt-0.5 text-xs text-muted-foreground">por SeguriData</span>
        </span>
      </header>

      {showSteps ? <SigningSteps current={stepIndex} className="mb-6" /> : null}

      {body}

      <Dialog open={rejectOpen} onOpenChange={(o) => !reject.isPending && setRejectOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Rechazar este documento?</DialogTitle>
            <DialogDescription>
              Esta acción es definitiva: se notificará al remitente y el enlace dejará de funcionar.
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" optional htmlFor="reject-reason" hint={`${reason.length}/500`}>
            <Textarea
              id="reject-reason"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" size="lg" disabled={reject.isPending} onClick={() => setRejectOpen(false)}>
              Mejor no, volver
            </Button>
            <Button variant="destructive" size="lg" disabled={reject.isPending} onClick={() => reject.mutate()}>
              {reject.isPending ? "Rechazando…" : "Rechazar documento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** Pantalla terminal: qué pasó, por qué y qué sigue (o que no hay nada más que hacer). */
function Outcome({
  icon,
  title,
  body,
  next,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  next: string;
  action?: React.ReactNode;
}) {
  return (
    <section role="status" className="space-y-4">
      <span className="flex items-center justify-center text-foreground [&_svg]:size-10 [&_svg]:stroke-[1.5]">
        {icon}
      </span>
      <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
      <p className="text-base leading-relaxed text-muted-foreground">{body}</p>
      <p className="rounded-lg bg-muted/60 p-4 text-sm leading-relaxed">{next}</p>
      {action}
    </section>
  );
}

function ReviewStep({
  ctx,
  onContinue,
  onReject,
}: {
  ctx: PublicLinkContext;
  onContinue: () => void;
  onReject: () => void;
}) {
  const expires = ctx.expiresAt
    ? new Date(ctx.expiresAt).toLocaleDateString("es-MX", { day: "numeric", month: "long" })
    : null;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight">
          {ctx.requestedByName ? `${ctx.requestedByName} te pidió firmar` : "Te pidieron firmar un documento"}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">Revisa los datos y continúa cuando estés listo.</p>
      </section>

      <section className="rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <span className="flex shrink-0 items-center justify-center text-muted-foreground">
            <FileText className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="break-words text-base font-medium">{ctx.documentTitle ?? "Documento por firmar"}</p>
            {ctx.signerName ? <p className="mt-0.5 text-sm text-muted-foreground">Firmas como {ctx.signerName}</p> : null}
          </div>
        </div>
        <p className="mt-4 border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
          El documento original quedó congelado: tu firma se registra sobre su huella y cualquier cambio posterior se
          detecta.
        </p>
      </section>

      <div className="space-y-3">
        <Button size="lg" className="h-14 w-full text-base" onClick={onContinue}>
          Continuar a firmar
        </Button>
        <Button type="button" variant="ghost" size="lg" className="h-12 w-full text-muted-foreground" onClick={onReject}>
          Rechazar este documento
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Este enlace es de un solo uso{expires ? ` y vence el ${expires}` : ""}.
      </p>
    </div>
  );
}

function SignStep({
  ctx,
  usable,
  unavailable,
  consent,
  setConsent,
  method,
  setMethod,
  setStroke,
  hasStroke,
  needsPasskey,
  passkeyVerified,
  verifyingPasskey,
  onVerifyPasskey,
  canSubmit,
  pending,
  onSubmit,
  onBack,
  onReject,
}: {
  ctx: PublicLinkContext;
  usable: Method[];
  unavailable: Method[];
  consent: boolean;
  setConsent: (v: boolean) => void;
  method: Method | null;
  setMethod: (m: Method) => void;
  setStroke: (b: Blob | null) => void;
  hasStroke: boolean;
  needsPasskey: boolean;
  passkeyVerified: boolean;
  verifyingPasskey: boolean;
  onVerifyPasskey: () => void;
  canSubmit: boolean;
  pending: boolean;
  onSubmit: () => void;
  onBack: () => void;
  onReject: () => void;
}) {
  // Lo que falta para poder firmar, dicho en una frase (el botón solo está apagado por esto).
  const missing = !method
    ? "Elige cómo firmar."
    : needsPasskey && !passkeyVerified
      ? "Verifica tu passkey para continuar."
      : method === "AUTOGRAFA" && !hasStroke
        ? "Dibuja tu firma para continuar."
        : !consent
          ? "Marca el consentimiento para poder firmar."
          : null;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight">Firma el documento</h1>
        <p className="mt-2 break-words text-base text-muted-foreground">{ctx.documentTitle ?? "Documento por firmar"}</p>
      </section>

      <fieldset>
        <legend className="mb-3 text-base font-semibold">
          {usable.length > 1 ? "Elige cómo firmar" : "Cómo vas a firmar"}
        </legend>
        <div className="space-y-2.5">
          {usable.map((m) => (
            <MethodOption key={m} selected={method === m} onSelect={() => setMethod(m)} {...SIGNING_METHOD_TEXT[m]}>
              {m === "AUTOGRAFA" && method === "AUTOGRAFA" ? (
                <div className="mt-3">
                  <AutographPad onChange={setStroke} />
                </div>
              ) : null}
            </MethodOption>
          ))}
          {unavailable.map((m) => (
            <MethodOption key={m} disabled selected={false} label={SIGNING_METHOD_TEXT[m].label} hint={unavailableReason(m)} />
          ))}
        </div>
        {usable.length === 0 ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            Ningún método de firma está disponible para este documento. Avisa al remitente.
          </p>
        ) : null}
      </fieldset>

      {needsPasskey ? (
        <PasskeyStep
          required={Boolean(ctx.requirePasskey)}
          verified={passkeyVerified}
          verifying={verifyingPasskey}
          onVerify={onVerifyPasskey}
        />
      ) : null}

      <ConsentCheck checked={consent} onChange={setConsent}>
        Acepto firmar electrónicamente este documento y que se registren la fecha, la hora y los datos técnicos de mi
        firma como evidencia.
      </ConsentCheck>

      <div className="space-y-3">
        <Button size="lg" className="h-14 w-full text-base" disabled={!canSubmit} onClick={onSubmit}>
          {pending ? "Firmando…" : method ? `Firmar con ${SIGNING_METHOD_TEXT[method].label}` : "Firmar documento"}
        </Button>
        {missing && !pending ? (
          <p className="text-center text-sm text-muted-foreground" role="status">
            {missing}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="lg" className="h-12 flex-1" disabled={pending} onClick={onBack}>
            Volver
          </Button>
          <Button type="button" variant="ghost" size="lg" className="h-12 flex-1 text-muted-foreground" disabled={pending} onClick={onReject}>
            Rechazar
          </Button>
        </div>
      </div>
    </div>
  );
}
