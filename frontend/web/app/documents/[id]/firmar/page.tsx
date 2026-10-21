"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CircleCheck, Clock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutographPad } from "@/components/signature/autograph-pad";
import {
  ConsentCheck,
  MethodOption,
  PasskeyStep,
  SIGNING_METHOD_TEXT,
  SigningSteps,
  unavailableReason,
} from "@/components/signature/signing-parts";
import { useSession } from "@/store/session-store";
import { signerBlockedBy } from "@/libs/signing-turn";
import { splitMethods } from "@/libs/allowed-methods";
import { DocumentViewer } from "@/components/documents/document-viewer";
import { fetchDocument } from "@/services/documents-service";
import {
  fetchConsentText,
  fetchSignatureRequestsForDocument,
  fetchSigningCapabilities,
  signRequest,
  verifyInternalPasskey,
} from "@/services/signature-requests-service";
import type { SignatureMethod } from "@/libs/types";

type Step = "revisar" | "firmar" | "listo";

/**
 * TP-16 — ceremonia de firma a pantalla completa (firmante interno). Sin chrome
 * de la app: PDF grande + pasos enfocados. Reutiliza los servicios reales.
 */
export default function CeremoniaFirmaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = use(params);
  const { signerId, name } = useSession();

  const [step, setStep] = useState<Step>("revisar");
  const [consent, setConsent] = useState(false);
  const [pickedMethod, setMethod] = useState<SignatureMethod | null>(null);
  const [stroke, setStroke] = useState<Blob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [assertionId, setAssertionId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  const doc = useQuery({ queryKey: ["document", documentId], queryFn: () => fetchDocument(documentId) });
  // URL same-origin: el navegador la sirve con su visor nativo, sin blob que revocar.
  const requests = useQuery({
    queryKey: ["signature-requests", documentId],
    queryFn: () => fetchSignatureRequestsForDocument(documentId),
  });
  const consentText = useQuery({ queryKey: ["consent-text"], queryFn: fetchConsentText });
  const caps = useQuery({ queryKey: ["signing-capabilities"], queryFn: fetchSigningCapabilities });

  const requestsData = requests.data;
  const capsData = caps.data;

  const mine = useMemo(() => {
    const isMine = (x: { signerId: string; delegatedTo?: string | null }) =>
      x.signerId === signerId || x.delegatedTo === signerId;
    const request = (requestsData ?? []).find((r) => {
      const s = r.signers.find(isMine);
      return Boolean(s) && s?.status === "PENDIENTE" && ["PENDIENTE", "EN_FIRMA"].includes(r.status);
    });
    const signer = request?.signers.find(isMine);
    if (!request || !signer) return null;
    // Secuencial: `blockedBy` = firmante anterior aún pendiente (o null si me toca).
    return { request, signer, blockedBy: signerBlockedBy(request, signerId) };
  }, [requestsData, signerId]);

  const { methods, unavailable } = useMemo(() => {
    const split = splitMethods(mine?.request.methods ?? [], mine?.request.allowedMethodsNow);
    const configured = new Set((capsData ?? []).filter((c) => c.configured).map((c) => c.method));
    return {
      methods: split.usable.filter((m) => configured.size === 0 || configured.has(m)),
      unavailable: split.unavailable,
    };
  }, [mine, capsData]);

  // Firmantes anteriores que aún no firman (orden secuencial): a quién se espera antes de tu turno.
  const waitingFor = useMemo(() => {
    if (!mine?.blockedBy) return [];
    const idx = mine.request.signers.findIndex((s) => s.signerId === signerId || s.delegatedTo === signerId);
    return mine.request.signers.slice(0, Math.max(idx, 0)).filter((s) => s.status === "PENDIENTE");
  }, [mine, signerId]);

  // Con un solo método posible no hay nada que elegir: queda seleccionado.
  const method = pickedMethod ?? (methods.length === 1 ? (methods[0] ?? null) : null);

  async function submit() {
    if (!mine || mine.blockedBy || !method) return;
    setSubmitting(true);
    try {
      await signRequest(
        mine.request.id,
        { method, consentAccepted: consent, passkeyAssertionId: assertionId ?? undefined },
        method === "AUTOGRAFA" ? stroke ?? undefined : undefined,
      );
      setStep("listo");
      toast.success("Firma aplicada.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const needsPasskey = Boolean(mine?.request.requirePasskey) || method === "PASSKEY";

  async function verifyPasskey() {
    if (!mine) return;
    setVerifying(true);
    setPasskeyError(null);
    try {
      setAssertionId(await verifyInternalPasskey(mine.request.id));
      toast.success("Passkey verificada.");
    } catch (e) {
      setPasskeyError((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  const loading = doc.isLoading || requests.isLoading;
  const canSubmit =
    consent && !!method && !submitting && (!needsPasskey || Boolean(assertionId)) && (method !== "AUTOGRAFA" || !!stroke);
  const missing = !method
    ? "Elige cómo firmar."
    : needsPasskey && !assertionId
      ? "Verifica tu passkey para continuar."
      : method === "AUTOGRAFA" && !stroke
        ? "Traza tu firma para continuar."
        : !consent
          ? "Marca el consentimiento para poder firmar."
          : null;

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="-ml-2 shrink-0">
            <Link href="/inbox">
              <ArrowLeft /> Bandeja
            </Link>
          </Button>
          <span className="truncate text-sm text-muted-foreground">Prestige · Firma de documento</span>
        </div>
        <span className="hidden shrink-0 text-sm text-muted-foreground sm:block">{name}</span>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground" role="status">
          Cargando el documento…
        </div>
      ) : !mine && step !== "listo" ? (
        <Notice
          title="No tienes una firma pendiente en este documento"
          body="Puede que ya hayas firmado o que la solicitud se haya cerrado."
          action={
            <Button asChild size="lg" variant="outline">
              <Link href={`/documents/${documentId}`}>Ver el expediente</Link>
            </Button>
          }
        />
      ) : mine?.blockedBy && step !== "listo" ? (
        <Notice
          icon={<Clock className="size-6" aria-hidden />}
          title="Aún no es tu turno de firmar"
          body={
            <>
              Este documento se firma en orden. Falta que firme{" "}
              <span className="font-medium text-foreground">{mine.blockedBy.name ?? mine.blockedBy.signerId}</span>
              {waitingFor.length > 1 ? (
                <>
                  {" "}
                  (y {waitingFor.length - 1} {waitingFor.length - 1 === 1 ? "persona más" : "personas más"} antes que tú)
                </>
              ) : null}
              . Te avisaremos en cuanto puedas firmar.
            </>
          }
          action={
            <Button asChild size="lg" variant="outline">
              <Link href={`/documents/${documentId}`}>Ver el expediente</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_400px]">
          {/* Solicitud y adjuntos */}
          <div className="min-h-[40vh] border-b border-border lg:border-b-0 lg:border-r">
            <DocumentViewer documentId={documentId} caseId={doc.data?.caseId} filename={doc.data?.filename ?? "Documento"} className="h-full" />
          </div>

          {/* Panel de pasos */}
          <aside className="flex flex-col gap-5 p-5 sm:p-6">
            <div>
              <h1 className="break-words text-xl font-semibold leading-tight tracking-tight">
                {doc.data?.filename ?? "Documento"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Enviado por {mine?.request.requestedByName ?? "Prestige"}
              </p>
            </div>

            <SigningSteps current={step === "revisar" ? 0 : step === "firmar" ? 1 : 2} />

            {step === "listo" ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <CircleCheck className="size-6" aria-hidden />
                  <h2 className="text-lg font-semibold">Firma completada</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Tu firma quedó registrada en el expediente de evidencia, con fecha y hora.
                </p>
                <div className="flex flex-col gap-2">
                  <Button asChild size="lg">
                    <Link href={`/documents/${documentId}/evidence`}>Ver evidencia</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/inbox">Volver a la bandeja</Link>
                  </Button>
                </div>
              </div>
            ) : null}

            {step === "revisar" ? (
              <div className="space-y-4">
                <p className="text-sm leading-relaxed">
                  Lee el documento completo en el visor. Cuando termines, continúa para elegir cómo firmar.
                </p>
                <Button size="lg" className="w-full" onClick={() => setStep("firmar")}>
                  Ya lo revisé, continuar
                </Button>
              </div>
            ) : null}

            {step === "firmar" ? (
              <div className="space-y-5">
                <fieldset>
                  <legend className="mb-3 text-base font-semibold">
                    {methods.length > 1 ? "Elige cómo firmar" : "Cómo vas a firmar"}
                  </legend>
                  <div className="space-y-2.5">
                    {methods.map((m) => (
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
                  {methods.length === 0 ? (
                    <p role="alert" className="mt-3 text-sm text-destructive">
                      Ningún método de firma está disponible ahora. Avisa a quien envió el documento.
                    </p>
                  ) : null}
                </fieldset>

                {needsPasskey ? (
                  <PasskeyStep
                    required={Boolean(mine?.request.requirePasskey)}
                    verified={Boolean(assertionId)}
                    verifying={verifying}
                    error={passkeyError}
                    onVerify={verifyPasskey}
                  />
                ) : null}

                <div className="space-y-2">
                  <p className="text-sm font-medium">Consentimiento</p>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed">
                    {consentText.data?.text ?? "Cargando el consentimiento…"}
                  </div>
                  <ConsentCheck checked={consent} onChange={setConsent}>
                    Acepto firmar electrónicamente y que se registren fecha, hora y datos técnicos como evidencia (versión{" "}
                    {consentText.data?.version ?? "—"}).
                  </ConsentCheck>
                </div>

                <div className="space-y-2">
                  <Button size="lg" className="h-14 w-full text-base" disabled={!canSubmit} onClick={submit}>
                    <ShieldCheck />
                    {submitting ? "Firmando…" : method ? `Firmar con ${SIGNING_METHOD_TEXT[method].label}` : "Firmar documento"}
                  </Button>
                  {missing && !submitting ? (
                    <p className="text-center text-sm text-muted-foreground" role="status">
                      {missing}
                    </p>
                  ) : null}
                  <Button variant="ghost" size="lg" className="w-full text-muted-foreground" onClick={() => setStep("revisar")}>
                    Volver a revisar
                  </Button>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </main>
  );
}

/** Pantalla centrada para los casos en que no se puede firmar: qué pasa y a dónde ir. */
function Notice({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <section role="status" className="flex max-w-md flex-col items-start gap-3">
        {icon ? (
          <span className="flex items-center justify-center text-foreground [&_svg]:size-10 [&_svg]:stroke-[1.5]">{icon}</span>
        ) : null}
        <h1 className="text-balance text-xl font-semibold leading-tight">{title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
        <div className="mt-1">{action}</div>
      </section>
    </div>
  );
}
