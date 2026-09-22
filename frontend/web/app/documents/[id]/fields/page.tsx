"use client";

import { use, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  PenTool,
  Save,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/libs/utils";

import { fetchDocument, documentContentUrl } from "@/services/documents-service";
import { fetchSignatureRequestsForDocument } from "@/services/signature-requests-service";
import { bulkCreateFields, fetchFields } from "@/services/signature-fields-service";
import type { DraftField, SignerColor } from "@/components/documents/field-editor-types";
import type { SignatureFieldType } from "@/libs/types";

const SignatureFieldCanvas = dynamic(
  () => import("@/components/documents/signature-field-canvas").then((m) => m.SignatureFieldCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">
        Preparando el visor de PDF…
      </div>
    ),
  },
);

const BASE_WIDTH = 680;

const FIELD_TYPE_OPTIONS: { value: SignatureFieldType; label: string; icon: typeof PenTool }[] = [
  { value: "SIGNATURE", label: "Firma", icon: PenTool },
  { value: "INITIALS", label: "Iniciales", icon: Type },
  { value: "DATE", label: "Fecha", icon: CalendarDays },
];

const DEFAULT_SIZE: Record<SignatureFieldType, { w: number; h: number }> = {
  SIGNATURE: { w: 0.2, h: 0.055 },
  INITIALS: { w: 0.09, h: 0.045 },
  DATE: { w: 0.13, h: 0.04 },
  TEXT: { w: 0.2, h: 0.045 },
};

const LABELS: Record<SignatureFieldType, string> = {
  SIGNATURE: "Firma",
  INITIALS: "Iniciales",
  DATE: "Fecha",
  TEXT: "Texto",
};

// Paleta desaturada consistente con los tokens de badge.tsx (success/warning/
// destructive) más dos tonos adicionales para diferenciar más firmantes sin
// recurrir a colores saturados o neón.
const SIGNER_PALETTE: SignerColor[] = [
  { border: "#84bd00", bg: "#eaf3d6", text: "#3f5900" },
  { border: "#3d6fa0", bg: "#e6eef5", text: "#274a66" },
  { border: "#a15c00", bg: "#fdf1e0", text: "#a15c00" },
  { border: "#7c5cbf", bg: "#efe9f7", text: "#4f3785" },
  { border: "#b3261e", bg: "#fbe9e7", text: "#8c2018" },
];

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function SignatureFieldsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: documentId } = use(params);
  const router = useRouter();

  const queryClient = useQueryClient();

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
  });

  const requestsQuery = useQuery({
    queryKey: ["signature-requests", "document", documentId],
    queryFn: () => fetchSignatureRequestsForDocument(documentId),
  });

  const fieldsQuery = useQuery({
    queryKey: ["signature-fields", documentId],
    queryFn: () => fetchFields(documentId),
  });

  const request = requestsQuery.data?.[0];
  const signers = useMemo(() => request?.signers ?? [], [request]);

  // pdf.js recibe una URL same-origin (usa PDFFetchStream). Ver SignatureFieldCanvas.
  const pdfUrl = documentContentUrl(documentId);

  const [draftFields, setDraftFields] = useState<DraftField[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [selectedSignerId, setSelectedSignerId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<SignatureFieldType>("SIGNATURE");
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (seeded || !fieldsQuery.data) return;
    setDraftFields(
      fieldsQuery.data.map((f) => ({
        key: crypto.randomUUID(),
        signerId: f.signerId,
        type: f.type,
        page: f.page,
        xPct: f.xPct,
        yPct: f.yPct,
        widthPct: f.widthPct,
        heightPct: f.heightPct,
        required: f.required,
      })),
    );
    setSeeded(true);
  }, [fieldsQuery.data, seeded]);

  useEffect(() => {
    const first = signers[0];
    if (selectedSignerId === null && first) {
      setSelectedSignerId(first.signerId);
    }
  }, [signers, selectedSignerId]);

  const colorFor = (signerId: string): SignerColor => {
    const index = signers.findIndex((s) => s.signerId === signerId);
    return SIGNER_PALETTE[(index < 0 ? 0 : index) % SIGNER_PALETTE.length] ?? SIGNER_PALETTE[0]!;
  };

  const initialsFor = (signerId: string) => {
    const signer = signers.find((s) => s.signerId === signerId);
    return initialsOf(signer?.name ?? signerId);
  };

  const nameFor = (signerId: string) => signers.find((s) => s.signerId === signerId)?.name ?? signerId;

  function handlePlaceField(rect: { xPct: number; yPct: number; widthPct: number; heightPct: number }) {
    if (!selectedSignerId) {
      toast.error("Selecciona primero a qué firmante pertenece el campo.");
      return;
    }
    setDraftFields((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        signerId: selectedSignerId,
        type: selectedType,
        page: pageNumber,
        required: true,
        ...rect,
      },
    ]);
  }

  function handleRemoveField(key: string) {
    setDraftFields((prev) => prev.filter((f) => f.key !== key));
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      bulkCreateFields(
        documentId,
        draftFields.map((f) => ({
          signerId: f.signerId,
          type: f.type,
          page: f.page,
          xPct: f.xPct,
          yPct: f.yPct,
          widthPct: f.widthPct,
          heightPct: f.heightPct,
          required: f.required,
        })),
      ),
    onSuccess: () => {
      toast.success("Campos de firma guardados.");
      queryClient.invalidateQueries({ queryKey: ["signature-fields", documentId] });
      router.push(`/documents/${documentId}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar los campos.");
    },
  });

  const fieldsOnPage = draftFields.filter((f) => f.page === pageNumber);
  const canPlace = Boolean(selectedSignerId && documentQuery.data);

  return (
    <AppShell title={`Campos · ${documentQuery.data?.filename ?? "Documento"}`}>
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Card className="flex h-[80vh] flex-col overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => router.push(`/documents/${documentId}`)}>
                <ArrowLeft className="size-4" strokeWidth={1.75} />
                Volver al documento
              </Button>

              <div className="flex items-center gap-3">
                {numPages ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pageNumber <= 1}
                      onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                      aria-label="Página anterior"
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="min-w-20 text-center text-xs text-muted-foreground">
                      Página {pageNumber} de {numPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pageNumber >= numPages}
                      onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                      aria-label="Página siguiente"
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                ) : null}

                <div className="flex items-center gap-1 border-l border-border pl-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={zoom <= 0.7}
                    onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.15).toFixed(2)))}
                    aria-label="Alejar"
                  >
                    <ZoomOut className="size-4" />
                  </Button>
                  <span className="min-w-10 text-center text-xs text-muted-foreground">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={zoom >= 1.6}
                    onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}
                    aria-label="Acercar"
                  >
                    <ZoomIn className="size-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-1 items-start justify-center overflow-auto bg-muted p-6">
              {documentQuery.isError ? (
                <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">
                  No se encontró el documento. Puede que haya sido eliminado.
                </div>
              ) : documentQuery.data ? (
                <SignatureFieldCanvas
                  fileUrl={pdfUrl}
                  pageNumber={pageNumber}
                  pageWidth={Math.round(BASE_WIDTH * zoom)}
                  onNumPages={setNumPages}
                  fieldsOnPage={fieldsOnPage}
                  colorFor={colorFor}
                  defaultSize={(type) => DEFAULT_SIZE[type]}
                  activeSignerId={selectedSignerId}
                  activeType={selectedType}
                  canPlace={canPlace}
                  onPlaceField={handlePlaceField}
                  onRemoveField={handleRemoveField}
                  labelFor={(type) => LABELS[type]}
                  initialsFor={initialsFor}
                />
              ) : (
                <div className="h-full w-full animate-pulse rounded-md bg-border/40" />
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08 }}
          className="flex flex-col gap-6"
        >
          {!requestsQuery.isLoading && !request ? (
            <Card className="p-6">
              <p className="text-sm font-medium text-foreground">
                Este documento todavía no tiene una solicitud de firma.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Crea la solicitud primero para poder asignar campos a cada firmante.
              </p>
            </Card>
          ) : (
            <>
              <Card className="p-6">
                <h2 className="text-base font-semibold text-foreground">1. Firmante</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Elige a quién le pertenece el siguiente campo que coloques.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  {signers.map((signer) => {
                    const color = colorFor(signer.signerId);
                    const active = signer.signerId === selectedSignerId;
                    return (
                      <button
                        key={signer.signerId}
                        type="button"
                        onClick={() => setSelectedSignerId(signer.signerId)}
                        className={cn(
                          "flex items-center gap-3 rounded-md border p-3 text-left transition-colors",
                          active ? "border-primary bg-accent" : "border-border hover:bg-muted",
                        )}
                      >
                        <span
                          className="size-3 shrink-0 rounded-full"
                          style={{ backgroundColor: color.border }}
                          aria-hidden
                        />
                        <span className="flex-1">
                          <span className="block text-sm font-medium text-foreground">
                            {signer.name ?? signer.signerId}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {signer.role === "REVISOR" ? "Revisor" : "Firmante"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>

              <Card className="p-6">
                <h2 className="text-base font-semibold text-foreground">2. Tipo de campo</h2>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {FIELD_TYPE_OPTIONS.map(({ value, label, icon: Icon }) => {
                    const active = value === selectedType;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSelectedType(value)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-md border p-3 text-center transition-colors",
                          active ? "border-primary bg-accent" : "border-border hover:bg-muted",
                        )}
                      >
                        <Icon className="size-4 text-primary" strokeWidth={1.75} />
                        <span className="text-xs font-medium text-foreground">{label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Haz clic y arrastra sobre el documento para dibujar el campo. Un clic simple coloca
                  un campo de tamaño estándar.
                </p>
              </Card>

              <Card className="flex-1 p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-foreground">Campos colocados</h2>
                  <span className="text-xs text-muted-foreground">{draftFields.length} en total</span>
                </div>
                <Separator className="my-4" />
                {draftFields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Todavía no colocas ningún campo. Selecciona un firmante y un tipo, y márcalos
                    directamente sobre el documento.
                  </p>
                ) : (
                  <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                    {draftFields.map((field) => {
                      const color = colorFor(field.signerId);
                      return (
                        <div
                          key={field.key}
                          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: color.border }}
                            aria-hidden
                          />
                          <span className="flex-1 truncate text-foreground">
                            {LABELS[field.type]} · {nameFor(field.signerId)}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            pág. {field.page}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveField(field.key)}
                            className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                          >
                            Quitar
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <Button
                  className="mt-6 w-full"
                  size="lg"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  <Save className="size-4" strokeWidth={1.75} />
                  {saveMutation.isPending ? "Guardando…" : "Guardar campos"}
                </Button>
              </Card>
            </>
          )}
        </motion.div>
      </div>
    </AppShell>
  );
}
