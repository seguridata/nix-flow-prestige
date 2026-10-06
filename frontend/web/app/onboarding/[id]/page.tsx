"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Camera, Check, CircleDashed, FileImage, UserCheck, X } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/documents/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { StepRail } from "@/components/onboarding/step-rail";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { shortHash } from "@/libs/envelope-status";
import {
  REVIEW_MODE_TEXT,
  biometricOutcome,
  enableBlockers,
  enabledReviewMode,
  hasConsent,
  isClosed,
  joinEs,
  nextAction,
  onboardingAuditLine,
  onboardingSteps,
  predictReviewMode,
  type OnboardingAuditEvent,
  type OnboardingCaseView,
} from "@/libs/onboarding-flow";
import { cn } from "@/libs/utils";
import { ApiError, apiClient } from "@/services/api-client";
import { buildOnboardingActionPayload, buildOnboardingEnablePayload } from "@/services/payloads";
import { useSession } from "@/store/session-store";

const when = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const KIND_TEXT: Record<string, string> = { EMPLEADO: "Empleado", PROVEEDOR: "Proveedor", CLIENTE: "Cliente" };

export default function OnboardingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { name: myName } = useSession();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  // El motor biométrico corrió y no pasó: RH solo habilita anulando con un motivo auditado.
  const [overrideMessage, setOverrideMessage] = useState<string | null>(null);
  const [overrideNotes, setOverrideNotes] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);

  const notice = useQuery({
    queryKey: ["biometric-consent"],
    queryFn: () => apiClient.get<{ version: string; text: string }>("/onboarding/biometric-consent"),
  });
  const query = useQuery({
    queryKey: ["onboarding", id],
    queryFn: () => apiClient.get<OnboardingCaseView>(`/onboarding/${id}`),
  });
  const audit = useQuery({
    queryKey: ["onboarding-audit", id],
    queryFn: () => apiClient.get<OnboardingAuditEvent[]>(`/process-audit?onboardingId=${id}`),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["onboarding", id] });
    queryClient.invalidateQueries({ queryKey: ["onboarding-audit", id] });
    queryClient.invalidateQueries({ queryKey: ["onboarding"] });
  }
  const fail = (fallback: string) => (error: unknown) => toast.error(error instanceof Error ? error.message : fallback);

  const acceptConsent = useMutation({
    mutationFn: () => apiClient.post(`/onboarding/${id}/biometric-consent`, { biometricConsent: true }),
    onSuccess: () => {
      toast.success("Consentimiento del titular registrado.");
      setConsentChecked(false);
      invalidate();
    },
    onError: fail("No se pudo registrar el consentimiento"),
  });

  const ine = useMutation({
    mutationFn: (payload: { part: "front" | "back"; file: File }) => {
      const form = new FormData();
      form.append("file", payload.file, payload.file.name);
      form.append("part", payload.part);
      return apiClient.post(`/onboarding/${id}/ine`, form);
    },
    onSuccess: () => {
      toast.success("INE guardada.");
      invalidate();
    },
    onError: fail("No se pudo guardar la INE"),
  });

  const liveness = useMutation({
    mutationFn: (selfie: Blob) => {
      const form = new FormData();
      form.append("file", selfie, "selfie.jpg");
      return apiClient.post(`/onboarding/${id}/liveness`, form);
    },
    onSuccess: () => {
      toast.success("Prueba de vida capturada.");
      stopCamera();
      invalidate();
    },
    onError: fail("No se pudo capturar"),
  });

  const verify = useMutation({
    mutationFn: () => apiClient.post(`/onboarding/${id}/actions/verify-ine`, buildOnboardingActionPayload()),
    onSuccess: () => {
      toast.success("INE verificada por RH.");
      invalidate();
    },
    onError: fail("No se pudo verificar"),
  });

  const enable = useMutation({
    mutationFn: (opts: { override?: boolean; notes?: string } = {}) =>
      apiClient.post(`/onboarding/${id}/actions/enable`, buildOnboardingEnablePayload(opts)),
    onSuccess: () => {
      toast.success("Firma habilitada.");
      setOverrideMessage(null);
      setOverrideNotes("");
      invalidate();
    },
    onError: (error) => {
      const body = error instanceof ApiError ? (error.body as { error?: string } | undefined) : undefined;
      if (error instanceof ApiError && error.status === 409 && body?.error === "BIOMETRIC_NOT_PASSED") {
        setOverrideMessage(error.message);
        return;
      }
      toast.error(error instanceof Error ? error.message : "No se pudo habilitar");
    },
  });

  const reject = useMutation({
    mutationFn: () =>
      apiClient.post(`/onboarding/${id}/actions/reject`, buildOnboardingActionPayload({ notes: "Rechazado por RH" })),
    onSuccess: () => {
      toast.success("Alta rechazada.");
      setConfirmReject(false);
      invalidate();
    },
    onError: fail("No se pudo rechazar"),
  });

  async function startCamera() {
    const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    setStream(media);
    setCameraOn(true);
    if (videoRef.current) videoRef.current.srcObject = media;
  }

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setCameraOn(false);
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) liveness.mutate(blob);
        else toast.error("No se pudo capturar el cuadro");
      },
      "image/jpeg",
      0.85,
    );
  }

  const row = query.data;
  const events = audit.data ?? [];

  if (query.isError) {
    return (
      <AppShell title="Alta de identidad">
        <div role="alert" className="mx-auto max-w-xl rounded-lg border border-border p-6 text-sm">
          No se pudo cargar esta alta.{" "}
          <Button variant="link" onClick={() => query.refetch()}>
            Reintentar
          </Button>
        </div>
      </AppShell>
    );
  }
  if (!row) {
    return (
      <AppShell title="Alta de identidad">
        <div className="mx-auto max-w-5xl space-y-4" aria-busy>
          <Skeleton className="h-10 w-80" />
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      </AppShell>
    );
  }

  const closed = isClosed(row);
  const consented = hasConsent(row);
  const steps = onboardingSteps(row);
  const next = nextAction(row);
  const outcome = biometricOutcome(row);
  const mode = predictReviewMode(row);
  const blockers = enableBlockers(row);
  const decided = enabledReviewMode(events);
  const canCapture = !closed && consented;

  return (
    <AppShell title={row.fullName}>
      <div className="mx-auto max-w-5xl">
        <Link
          href="/onboarding"
          className="mb-4 inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden /> Altas de identidad
        </Link>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Alta de identidad — {row.fullName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {KIND_TEXT[row.kind] ?? row.kind} · {row.email}
              {row.curp ? ` · CURP ${row.curp}` : ""}
              {row.rfc ? ` · RFC ${row.rfc}` : ""}
            </p>
            <p className={cn("mt-2 text-sm", next.needsRh ? "font-medium" : "text-muted-foreground")}>{next.sentence}</p>
          </div>
          <StatusBadge status={row.status} />
        </header>

        <div className="mt-7 rounded-lg border border-border px-3 py-4 sm:px-6">
          <StepRail steps={steps} />
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <Panel title="Consentimiento del titular">
              {consented ? (
                <p className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    Aceptado el {when.format(new Date(row.biometricConsentAt!))}
                    {row.biometricConsentVersion ? `, versión ${row.biometricConsentVersion}` : ""}.
                    <span className="block text-muted-foreground">
                      Sin esta constancia no se guarda la INE ni la captura facial.
                    </span>
                  </span>
                </p>
              ) : closed ? (
                <p className="text-sm text-muted-foreground">
                  Esta alta se cerró sin una constancia de consentimiento registrada en el sistema.
                </p>
              ) : (
                <>
                  <p className="max-h-44 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">
                    {notice.data?.text ?? "Cargando el texto del consentimiento…"}
                  </p>
                  <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm leading-snug">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-5 shrink-0 accent-[var(--brand-carbon)]"
                      checked={consentChecked}
                      onChange={(e) => setConsentChecked(e.target.checked)}
                    />
                    <span>
                      El titular acepta por escrito el tratamiento de su biometría y de su INE (versión{" "}
                      {notice.data?.version ?? "…"}).
                    </span>
                  </label>
                  <Button className="mt-3" disabled={!consentChecked || !notice.data || acceptConsent.isPending} onClick={() => acceptConsent.mutate()}>
                    {acceptConsent.isPending ? "Registrando…" : "Registrar consentimiento"}
                  </Button>
                </>
              )}
            </Panel>

            <Panel
              title="INE"
              aside={row.ineHash ? <HashChip value={row.ineHash} label="hash" /> : null}
              note="Cada imagen se guarda cifrada en el expediente y solo se conserva su hash; Prestige no la vuelve a mostrar en pantalla. La validación contra INE/RENAPO es revisión de RH."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <IneSlot label="Frente" loaded={row.hasIneFront} disabled={!canCapture || ine.isPending} onPick={(file) => ine.mutate({ part: "front", file })} />
                <IneSlot label="Reverso" loaded={row.hasIneBack} disabled={!canCapture || ine.isPending} onPick={(file) => ine.mutate({ part: "back", file })} />
              </div>
              {!consented && !closed ? <p className="mt-3 text-sm text-muted-foreground">Registra el consentimiento para poder cargar la INE.</p> : null}
            </Panel>

            <Panel
              title="Prueba de vida"
              aside={row.livenessHash ? <HashChip value={row.livenessHash} label="hash" /> : null}
              note="Se usa la cámara del navegador. Si hay motor biométrico se consulta; si no, decide RH."
            >
              <div className="flex h-56 items-center justify-center overflow-hidden rounded-lg bg-secondary">
                <video ref={videoRef} autoPlay playsInline muted className={cn("size-full object-cover", !cameraOn && "hidden")} />
                {!cameraOn ? (
                  <p className="flex flex-col items-center gap-2 px-4 text-center text-sm text-secondary-foreground/80">
                    <Camera className="size-6" aria-hidden />
                    {row.hasSelfie ? "Selfie guardada en el expediente. Puedes capturar otra." : "La cámara está apagada."}
                  </p>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {!cameraOn ? (
                  <Button variant="outline" disabled={!canCapture} onClick={() => startCamera().catch(() => toast.error("No se pudo abrir la cámara."))}>
                    <Camera /> Encender cámara
                  </Button>
                ) : (
                  <>
                    <Button onClick={captureFrame} disabled={liveness.isPending}>
                      {liveness.isPending ? "Enviando…" : "Capturar"}
                    </Button>
                    <Button variant="outline" onClick={stopCamera}>
                      Apagar
                    </Button>
                  </>
                )}
              </div>
            </Panel>
          </div>

          <div className="space-y-5 lg:sticky lg:top-6 lg:self-start">
            <Panel title="Resultado biométrico">
              <div className="rounded-lg bg-muted/60 p-4 text-center">
                <p className="text-base font-medium">{outcome.title}</p>
                {outcome.detail ? <p className="mt-1 text-sm text-muted-foreground">{outcome.detail}</p> : null}
              </div>
              <ul className="mt-4 divide-y divide-border text-sm">
                <Check3 ok={row.ineVerified} text={row.ineVerified ? "INE verificada por RH" : "INE sin verificar por RH"} />
                <Check3
                  ok={row.hasSelfie ? row.livenessOk || undefined : false}
                  text={row.livenessOk ? "Prueba de vida registrada como correcta" : row.hasSelfie ? "Prueba de vida: pendiente de tu criterio" : "Prueba de vida: sin capturar"}
                />
                <Check3
                  ok={row.hasSelfie ? row.faceMatchOk || undefined : false}
                  text={row.faceMatchOk ? "Rostro coincide con la INE" : row.hasSelfie ? "Coincidencia del rostro: pendiente de tu criterio" : "Coincidencia del rostro: sin capturar"}
                />
              </ul>
            </Panel>

            <Panel title="Decisión de RH">
              {row.status === "HABILITADO" ? (
                <div className="space-y-2 text-sm">
                  <p className="flex items-start gap-2 font-medium">
                    <UserCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> Firma habilitada
                    {row.enabledSignerId ? <span className="font-mono text-xs font-normal text-muted-foreground">({row.enabledSignerId})</span> : null}
                  </p>
                  {decided ? (
                    <>
                      <p>
                        {REVIEW_MODE_TEXT[decided.mode].label} · {decided.actor}
                      </p>
                      <p className="text-muted-foreground">{REVIEW_MODE_TEXT[decided.mode].detail}</p>
                      {decided.notes ? (
                        <p className="rounded-md border border-border bg-muted/40 p-2.5">
                          <span className="font-medium">Motivo de la anulación: </span>
                          {decided.notes}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : row.status === "RECHAZADO" ? (
                <p className="flex items-start gap-2 text-sm font-medium">
                  <X className="mt-0.5 size-4 shrink-0" aria-hidden /> Alta rechazada por RH.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {!row.ineVerified ? (
                    <Button variant="outline" className="w-full" onClick={() => verify.mutate()} disabled={verify.isPending || !row.hasIneFront || !row.hasIneBack}>
                      {verify.isPending ? "Verificando…" : "Verificar INE"}
                    </Button>
                  ) : null}
                  {mode === "needs-override" ? (
                    <Button
                      className="w-full"
                      disabled={blockers.length > 0 || enable.isPending}
                      onClick={() => setOverrideMessage("El motor biométrico no confirmó la identidad. Puedes habilitar de todos modos si justificas tu decisión.")}
                    >
                      Anular resultado y habilitar…
                    </Button>
                  ) : (
                    <Button className="w-full" disabled={blockers.length > 0 || enable.isPending} onClick={() => setConfirmEnable(true)}>
                      Habilitar firma
                    </Button>
                  )}
                  {blockers.length > 0 ? <p className="text-sm text-muted-foreground">Falta {joinEs(blockers)}.</p> : null}
                  <Button variant="ghost" className="w-full text-destructive hover:text-destructive" disabled={reject.isPending} onClick={() => setConfirmReject(true)}>
                    <Ban /> Rechazar alta
                  </Button>
                  <p className="flex items-start gap-2 border-t border-border pt-3 text-sm text-muted-foreground">
                    <UserCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      Tu decisión queda en la auditoría con tu nombre{myName ? ` (${myName})` : ""} y el modo de revisión:{" "}
                      <span className="font-medium text-foreground">
                        {mode === "needs-override" ? "anulación manual con motivo" : REVIEW_MODE_TEXT[mode].label.toLowerCase()}
                      </span>
                      .
                    </span>
                  </p>
                </div>
              )}
            </Panel>
          </div>
        </div>

        <Panel className="mt-5" title="Auditoría">
          {audit.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando eventos…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay eventos registrados.</p>
          ) : (
            <ol className="divide-y divide-border">
              {events.map((e, i) => {
                const line = onboardingAuditLine(e);
                return (
                  <li key={`${e.action}-${e.createdAt}-${i}`} className="flex items-start gap-3 py-2.5 text-sm">
                    <span className="mt-0.5 w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{when.format(new Date(e.createdAt))}</span>
                    {line.human ? <UserCheck className="mt-0.5 size-4 shrink-0" aria-label="Decisión humana" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className={cn(line.human && "font-medium")}>{line.title}</span>
                      {line.detail ? <span className="text-muted-foreground"> · {line.detail}</span> : null}
                      <span className="block text-xs text-muted-foreground">{line.actor}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={confirmEnable}
        onOpenChange={setConfirmEnable}
        title="Habilitar firma"
        description={`RH confirma que la INE fue revisada y habilita a ${row.fullName}. Queda registrado como: ${mode === "needs-override" ? "anulación manual" : REVIEW_MODE_TEXT[mode].label.toLowerCase()}.`}
        confirmLabel="Habilitar"
        pending={enable.isPending}
        onConfirm={() => {
          enable.mutate({});
          setConfirmEnable(false);
        }}
      />
      <ConfirmDialog
        open={confirmReject}
        onOpenChange={setConfirmReject}
        title="¿Rechazar esta alta?"
        description={`${row.fullName} no podrá firmar en Prestige con esta alta. El rechazo queda en la auditoría.`}
        confirmLabel="Rechazar alta"
        destructive
        pending={reject.isPending}
        onConfirm={() => reject.mutate()}
      />
      <Dialog open={overrideMessage !== null} onOpenChange={(o) => !enable.isPending && !o && setOverrideMessage(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>La prueba biométrica no pasó</DialogTitle>
            <DialogDescription>{overrideMessage}</DialogDescription>
          </DialogHeader>
          <label className="text-sm font-medium" htmlFor="override-notes">
            Motivo de la anulación (mínimo 10 caracteres; queda en la auditoría con tu nombre)
          </label>
          <textarea
            id="override-notes"
            className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm"
            value={overrideNotes}
            maxLength={2000}
            onChange={(e) => setOverrideNotes(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOverrideMessage(null)} disabled={enable.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={() => enable.mutate({ override: true, notes: overrideNotes })}
              disabled={enable.isPending || overrideNotes.trim().length < 10}
            >
              Habilitar con anulación
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Panel({
  title,
  aside,
  note,
  className,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-background p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {note ? <p className="-mt-1 mb-3 text-sm text-muted-foreground">{note}</p> : null}
      {children}
    </section>
  );
}

function HashChip({ value, label }: { value: string; label: string }) {
  return (
    <code className="rounded bg-muted px-2 py-1 font-mono text-xs tabular-nums text-muted-foreground" title={value}>
      {label} {shortHash(value)}
    </code>
  );
}

/** Casilla de resultado: check (sí), aro vacío (pendiente de criterio) o cruz (falta). */
function Check3({ ok, text }: { ok: boolean | undefined; text: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          ok === true && "border-primary bg-primary text-primary-foreground",
          ok === undefined && "border-2 border-foreground",
          ok === false && "border-border text-muted-foreground",
        )}
      >
        {ok === true ? <Check className="size-3.5" strokeWidth={3} /> : null}
        {ok === false ? <X className="size-3" strokeWidth={3} /> : null}
      </span>
      <span>{text}</span>
    </li>
  );
}

function IneSlot({
  label,
  loaded,
  disabled,
  onPick,
}: {
  label: string;
  loaded: boolean;
  disabled: boolean;
  onPick: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border p-3", loaded ? "border-border" : "border-dashed border-border")}>
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          loaded ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {loaded ? <Check className="size-5" strokeWidth={3} /> : <FileImage className="size-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">INE, {label.toLowerCase()}</span>
        <span className="block text-xs text-muted-foreground">{loaded ? "Guardada cifrada" : "Falta cargar"}</span>
      </span>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>
        {loaded ? "Reemplazar" : "Elegir imagen"}
      </Button>
    </div>
  );
}
