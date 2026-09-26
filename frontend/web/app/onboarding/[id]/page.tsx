"use client";

import { use, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/documents/status-badge";
import { Stepper } from "@/components/ui/stepper";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSession } from "@/store/session-store";
import { apiClient } from "@/services/api-client";

interface OnboardingDetail {
  id: string;
  kind: string;
  status: string;
  fullName: string;
  email: string;
  curp?: string | null;
  rfc?: string | null;
  ineVerified: boolean;
  hasIneFront: boolean;
  hasIneBack: boolean;
  hasSelfie: boolean;
  livenessOk: boolean;
  faceMatchOk: boolean;
  enabledSignerId?: string | null;
  notes?: string | null;
  biometricConsentAt?: string | null;
  biometricConsentVersion?: string | null;
}

export default function OnboardingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { signerId, name } = useSession();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [biometricConsent, setBiometricConsent] = useState(false);
  const notice = useQuery({
    queryKey: ["biometric-consent"],
    queryFn: () => apiClient.get<{ version: string; text: string }>("/onboarding/biometric-consent"),
  });

  const query = useQuery({
    queryKey: ["onboarding", id],
    queryFn: () => apiClient.get<OnboardingDetail>(`/onboarding/${id}`),
  });
  const audit = useQuery({
    queryKey: ["onboarding-audit", id],
    queryFn: () => apiClient.get<{ action: string; actorId: string; createdAt: string }[]>(`/process-audit?onboardingId=${id}`),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["onboarding", id] });
    queryClient.invalidateQueries({ queryKey: ["onboarding-audit", id] });
    queryClient.invalidateQueries({ queryKey: ["onboarding"] });
  }

  const acceptConsent = useMutation({
    mutationFn: () => apiClient.post(`/onboarding/${id}/biometric-consent`, { biometricConsent: true }),
    onSuccess: () => {
      toast.success("Consentimiento del titular registrado.");
      setBiometricConsent(false);
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo registrar el consentimiento"),
  });

  const ine = useMutation({
    mutationFn: (payload: { part: "front" | "back"; file: File }) => {
      const form = new FormData();
      form.append("file", payload.file, payload.file.name);
      form.append("part", payload.part);
      form.append("actorId", signerId);
      form.append("actorName", name);
      return apiClient.post(`/onboarding/${id}/ine`, form);
    },
    onSuccess: () => {
      toast.success("INE guardada.");
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo guardar la INE"),
  });

  const liveness = useMutation({
    mutationFn: (selfie: Blob) => {
      const form = new FormData();
      form.append("file", selfie, "selfie.jpg");
      form.append("actorId", signerId);
      form.append("actorName", name);
      return apiClient.post(`/onboarding/${id}/liveness`, form);
    },
    onSuccess: () => {
      toast.success("Prueba de vida capturada.");
      stopCamera();
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo capturar"),
  });

  const verify = useMutation({
    mutationFn: () => apiClient.post(`/onboarding/${id}/actions/verify-ine`, { actorId: signerId, actorName: name }),
    onSuccess: () => {
      toast.success("INE verificada por RH.");
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo verificar"),
  });

  const enable = useMutation({
    mutationFn: () => apiClient.post(`/onboarding/${id}/actions/enable`, { actorId: signerId, actorName: name }),
    onSuccess: () => {
      toast.success("Firma habilitada.");
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo habilitar"),
  });

  const reject = useMutation({
    mutationFn: () =>
      apiClient.post(`/onboarding/${id}/actions/reject`, { actorId: signerId, actorName: name, notes: "Rechazado por RH" }),
    onSuccess: () => {
      toast.success("Alta rechazada.");
      invalidate();
    },
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
  const closed = row?.status === "HABILITADO" || row?.status === "RECHAZADO";
  const consented = Boolean(row?.biometricConsentAt);

  return (
    <AppShell title={row?.fullName ?? "Onboarding"}>
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <Stepper
            steps={[
              { id: "consent", label: "Consentimiento" },
              { id: "datos", label: "Datos" },
              { id: "ine", label: "INE" },
              { id: "vida", label: "Prueba de vida" },
              { id: "rh", label: "RH" },
            ]}
            current={
              !consented
                ? 0
                : row?.status === "HABILITADO"
                  ? 5
                  : row?.status === "EN_REVISION" || row?.status === "PRUEBA_VIDA"
                    ? 4
                    : row?.status === "INE"
                      ? 3
                      : 2
            }
          />
          <div className="mt-6 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">M16 · {row?.kind}</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">{row?.fullName ?? "Cargando…"}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{row?.email}</p>
            </div>
            {row ? <StatusBadge status={row.status} /> : null}
          </div>

          <Card className="mt-6 p-6">
            <h2 className="text-sm font-semibold">Consentimiento del titular</h2>
            {consented ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Aceptado por escrito el {new Date(row!.biometricConsentAt!).toLocaleString("es-MX")}
                {row?.biometricConsentVersion ? ` · versión ${row.biometricConsentVersion}` : ""}. Sin esta constancia
                no se guarda la INE ni la captura facial.
              </p>
            ) : (
              <>
                <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">
                  {notice.data?.text ?? "Cargando el texto del consentimiento…"}
                </p>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={biometricConsent}
                    onChange={(event) => setBiometricConsent(event.target.checked)}
                  />
                  <span>
                    El titular acepta por escrito el tratamiento de su biometría y de su INE (versión{" "}
                    {notice.data?.version ?? "…"}). La casilla no viene marcada.
                  </span>
                </label>
                <Button
                  className="mt-3"
                  disabled={!biometricConsent || !notice.data || acceptConsent.isPending}
                  onClick={() => acceptConsent.mutate()}
                >
                  {acceptConsent.isPending ? "Registrando…" : "Registrar consentimiento"}
                </Button>
              </>
            )}
          </Card>

          <Card className="mt-4 p-6">
            <h2 className="text-sm font-semibold">1. INE — frente y reverso</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Se guarda el hash SHA-256. La validación contra INE/RENAPO es revisión de RH hasta conectar el
              servicio oficial.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="rounded-md border border-dashed border-border p-4 text-sm">
                Frente {row?.hasIneFront ? "· cargado" : ""}
                <input
                  type="file"
                  accept="image/*"
                  className="mt-2 block w-full text-xs"
                  disabled={closed || !consented}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) ine.mutate({ part: "front", file });
                  }}
                />
              </label>
              <label className="rounded-md border border-dashed border-border p-4 text-sm">
                Reverso {row?.hasIneBack ? "· cargado" : ""}
                <input
                  type="file"
                  accept="image/*"
                  className="mt-2 block w-full text-xs"
                  disabled={closed || !consented}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) ine.mutate({ part: "back", file });
                  }}
                />
              </label>
            </div>
          </Card>

          <Card className="mt-4 p-6">
            <h2 className="text-sm font-semibold">2. Prueba de vida</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Cámara del navegador. Si hay proveedor biométrico se llama; si no, queda en revisión de RH.
            </p>
            <video ref={videoRef} autoPlay playsInline muted className="mt-4 h-56 w-full rounded-md bg-secondary object-cover" />
            <div className="mt-3 flex gap-2">
              {!cameraOn ? (
                <Button variant="outline" onClick={() => startCamera().catch(() => toast.error("No hay cámara"))} disabled={closed || !consented}>
                  Encender cámara
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
              {row?.hasSelfie ? <span className="self-center text-xs text-muted-foreground">Selfie en expediente</span> : null}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Revisión RH</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>CURP {row?.curp ?? "—"}</li>
              <li>RFC {row?.rfc ?? "—"}</li>
              <li>INE verificada: {row?.ineVerified ? "sí" : "no"}</li>
              <li>Liveness: {row?.livenessOk ? "sí" : "captura / pendiente de motor"}</li>
              <li>Face-match: {row?.faceMatchOk ? "sí" : "pendiente de motor"}</li>
              {row?.enabledSignerId ? <li className="font-mono text-xs">signer {row.enabledSignerId}</li> : null}
            </ul>
            {!closed ? (
              <div className="mt-4 flex flex-col gap-2">
                <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
                  Verificar INE
                </Button>
                <Button onClick={() => setConfirmEnable(true)} disabled={enable.isPending || !consented}>
                  Habilitar firma
                </Button>
                <Button variant="destructive" onClick={() => reject.mutate()}>
                  Rechazar
                </Button>
              </div>
            ) : null}
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Auditoría</h2>
            <ul className="mt-3 space-y-2 text-xs">
              {(audit.data ?? []).map((e, i) => (
                <li key={`${e.action}-${i}`}>
                  <span className="font-medium">{e.action}</span>
                  <span className="ml-2 text-muted-foreground">{new Date(e.createdAt).toLocaleString("es-MX")}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={confirmEnable}
        onOpenChange={setConfirmEnable}
        title="Habilitar firma"
        description="RH confirma que la INE fue revisada. La persona podrá firmar en Prestige."
        confirmLabel="Habilitar"
        pending={enable.isPending}
        onConfirm={() => {
          enable.mutate();
          setConfirmEnable(false);
        }}
      />
    </AppShell>
  );
}
