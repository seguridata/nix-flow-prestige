"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutographPad } from "@/components/signature/autograph-pad";
import { useSession } from "@/store/session-store";
import { signerBlockedBy } from "@/libs/signing-turn";
import { fetchDocument, documentContentUrl } from "@/services/documents-service";
import {
  fetchConsentText,
  fetchSignatureRequestsForDocument,
  fetchSigningCapabilities,
  signRequest,
} from "@/services/signature-requests-service";
import type { SignatureMethod } from "@/libs/types";

type Step = "revisar" | "consentimiento" | "metodo" | "listo";

const METHOD_LABEL: Record<string, string> = {
  DIGITAL: "Firma digital (PAdES)",
  AUTOGRAFA: "Firma autógrafa",
  BIOMETRICA: "Firma biométrica",
};

/**
 * TP-16 — ceremonia de firma a pantalla completa (firmante interno). Sin chrome
 * de la app: PDF grande + pasos enfocados. Reutiliza los servicios reales.
 */
export default function CeremoniaFirmaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = use(params);
  const { signerId, name } = useSession();

  const [step, setStep] = useState<Step>("revisar");
  const [consent, setConsent] = useState(false);
  const [method, setMethod] = useState<SignatureMethod | null>(null);
  const [stroke, setStroke] = useState<Blob | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const doc = useQuery({ queryKey: ["document", documentId], queryFn: () => fetchDocument(documentId) });
  // URL same-origin: el navegador la sirve con su visor nativo, sin blob que revocar.
  const pdfSrc = documentContentUrl(documentId);
  const requests = useQuery({
    queryKey: ["signature-requests", documentId],
    queryFn: () => fetchSignatureRequestsForDocument(documentId),
  });
  const consentText = useQuery({ queryKey: ["consent-text"], queryFn: fetchConsentText });
  const caps = useQuery({ queryKey: ["signing-capabilities"], queryFn: fetchSigningCapabilities });

  const mine = useMemo(() => {
    for (const r of requests.data ?? []) {
      const s = r.signers.find(
        (x) => x.signerId === signerId || x.delegatedTo === signerId,
      );
      if (!s || s.status !== "PENDIENTE" || !["PENDIENTE", "EN_FIRMA"].includes(r.status)) {
        continue;
      }
      // Secuencial: `blockedBy` = firmante anterior aún pendiente (o null si me toca).
      return { request: r, signer: s, blockedBy: signerBlockedBy(r, signerId) };
    }
    return null;
  }, [requests.data, signerId]);

  const methods = useMemo(() => {
    const allowed = mine?.request.methods ?? [];
    const configured = new Set((caps.data ?? []).filter((c) => c.configured).map((c) => c.method));
    return allowed.filter((m) => configured.size === 0 || configured.has(m));
  }, [mine, caps.data]);

  async function submit() {
    if (!mine || mine.blockedBy || !method) return;
    setSubmitting(true);
    try {
      await signRequest(
        mine.request.id,
        { method, consentAccepted: consent },
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

  const loading = doc.isLoading || requests.isLoading;

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/inbox">
              <ChevronLeft className="mr-1 size-4" /> Bandeja
            </Link>
          </Button>
          <span className="text-sm font-bold tracking-wide">PRESTIGE</span>
          <span className="text-xs text-muted-foreground">· Ceremonia de firma</span>
        </div>
        <span className="text-xs text-muted-foreground">{name}</span>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Cargando el documento…
        </div>
      ) : !mine && step !== "listo" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="text-lg font-semibold">No tienes una firma pendiente en este documento</h1>
          <Button asChild variant="outline">
            <Link href={`/documents/${documentId}`}>Ver el expediente</Link>
          </Button>
        </div>
      ) : mine?.blockedBy && step !== "listo" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="text-lg font-semibold">Aún no es tu turno de firmar</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Este documento se firma en orden secuencial. Falta que firme{" "}
            <span className="font-medium text-foreground">
              {mine.blockedBy.name ?? mine.blockedBy.signerId}
            </span>
            . Te avisaremos en cuanto puedas firmar.
          </p>
          <Button asChild variant="outline">
            <Link href={`/documents/${documentId}`}>Ver el expediente</Link>
          </Button>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_380px]">
          {/* PDF */}
          <div className="min-h-[40vh] border-b border-border bg-muted/40 lg:border-b-0 lg:border-r">
            <object data={pdfSrc} type="application/pdf" className="h-full min-h-[60vh] w-full">
              <div className="p-6 text-sm">
                <a href={pdfSrc} target="_blank" rel="noreferrer" className="underline">
                  Abrir el PDF
                </a>
              </div>
            </object>
          </div>

          {/* Panel de pasos */}
          <aside className="flex flex-col gap-4 p-6">
            <h1 className="text-lg font-semibold">{doc.data?.filename ?? "Documento"}</h1>
            <p className="text-sm text-muted-foreground">
              Enviado por {mine?.request.requestedByName ?? "Prestige"}
            </p>

            {step === "listo" ? (
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <CheckCircle2 className="size-5" />
                  <span className="font-medium">Firma completada</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Tu firma quedó registrada en el expediente de evidencia (manifiesto firmado + sello
                  de tiempo).
                </p>
                <div className="flex gap-2">
                  <Button asChild className="flex-1">
                    <Link href={`/documents/${documentId}/evidence`}>Ver evidencia</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/inbox">Bandeja</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Stepper step={step} />

                {step === "revisar" && (
                  <div className="mt-2 space-y-4 text-sm">
                    <p>Revisa el documento completo antes de continuar.</p>
                    <Button className="w-full" onClick={() => setStep("consentimiento")}>
                      Ya lo revisé
                    </Button>
                  </div>
                )}

                {step === "consentimiento" && (
                  <div className="mt-2 space-y-4">
                    <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed">
                      {consentText.data?.text ?? "Cargando el consentimiento…"}
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>
                        Acepto firmar electrónicamente y que se registren fecha, hora y datos técnicos
                        como evidencia (versión {consentText.data?.version ?? "—"}).
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setStep("revisar")}>
                        Atrás
                      </Button>
                      <Button className="flex-1" disabled={!consent} onClick={() => setStep("metodo")}>
                        Continuar
                      </Button>
                    </div>
                  </div>
                )}

                {step === "metodo" && (
                  <div className="mt-2 space-y-4">
                    <p className="text-sm font-medium">Método de firma</p>
                    <div className="flex flex-wrap gap-2">
                      {methods.map((m) => (
                        <Button
                          key={m}
                          size="sm"
                          variant={method === m ? "default" : "outline"}
                          onClick={() => setMethod(m)}
                        >
                          {METHOD_LABEL[m] ?? m}
                        </Button>
                      ))}
                    </div>
                    {method === "AUTOGRAFA" && (
                      <div>
                        <p className="mb-2 text-sm font-medium">Traza tu firma</p>
                        <div className="h-40 rounded-md border border-border">
                          <AutographPad onChange={setStroke} />
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setStep("consentimiento")}>
                        Atrás
                      </Button>
                      <Button
                        className="flex-1"
                        disabled={
                          !method || submitting || (method === "AUTOGRAFA" && !stroke)
                        }
                        onClick={submit}
                      >
                        <ShieldCheck className="mr-1 size-4" />
                        {submitting ? "Firmando…" : "Firmar documento"}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "revisar", label: "Revisar" },
    { key: "consentimiento", label: "Consentimiento" },
    { key: "metodo", label: "Firmar" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={`flex size-6 items-center justify-center rounded-full border ${
              i <= idx ? "border-primary bg-primary text-primary-foreground" : "border-border"
            }`}
          >
            {i + 1}
          </span>
          <span className={i === idx ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
