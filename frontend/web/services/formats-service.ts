import { ApiError, apiClient } from "./api-client";
import type { AttachmentSpec } from "@/libs/attachments";
import type { Flow, FlowStep, VarType } from "@/libs/flow";

export type { AttachmentSpec } from "@/libs/attachments";

/** `PDF`: el administrador sube el documento. `FORM`: el sistema genera la hoja base (ADR-008 §7). */
export type FormatKind = "PDF" | "FORM";

export interface FormatField {
  key: string;
  label: string;
  type: VarType;
  required: boolean;
  options?: string[];
  /** Posición en el PDF: página (desde 1) y fracciones 0–1 con origen arriba a la izquierda. */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  align?: "left" | "center";
  prefill?: "user.name" | "user.email" | "today";
}

export interface SignatureBox {
  stepId: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MethodName = "DIGITAL" | "AUTOGRAFA" | "BIOMETRICA" | "ACCEPT" | "PASSKEY";

export interface FormatSummary {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  published: boolean;
  fieldCount: number;
  stepCount: number;
  createdAt: string;
  kind?: FormatKind;
  attachmentCount?: number;
}

export interface FormatDetail {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  published: boolean;
  kind?: FormatKind;
  /** Anexos que pide el formato (vacío si no pide ninguno). */
  attachmentSpecs?: AttachmentSpec[];
  pageCount: number;
  fields: FormatField[];
  signatureBoxes: SignatureBox[];
  flow: Flow;
  flowKey: string | null;
  flowVersion: number | null;
  methods: MethodName[];
  kycPolicy: "NONE" | "ONCE" | "EVERY_SIGN";
  requirePasskey: boolean;
}

/** Cuerpo editable de un formato (lo que se manda a crear o guardar). */
export interface FormatDraft {
  name: string;
  description?: string;
  category?: string;
  fields: FormatField[];
  signatureBoxes: SignatureBox[];
  attachmentSpecs?: AttachmentSpec[];
  flow: Flow;
  flowKey?: string;
  flowVersion?: number;
  methods: MethodName[];
  kycPolicy: "NONE" | "ONCE" | "EVERY_SIGN";
  requirePasskey: boolean;
}

export interface ResolvedStep {
  stepId: string;
  label: string;
  role: FlowStep["role"];
  who: FlowStep["who"];
  active: boolean;
  /** Persona que una tabla de consulta resolvió para un paso `lookup`. */
  resolved?: { signerId: string; name?: string; email?: string };
  /**
   * Paso `lookup` con todos sus datos de entrada completos pero sin coincidencia en la tabla: se pregunta con el `prompt`.
   * Es excluyente con `awaiting`.
   */
  unresolved?: boolean;
  /**
   * Paso `lookup` activo cuyos datos de entrada aún no están completos: variables obligatorias que faltan (etiquetas del
   * flujo, nunca la consulta). La persona se asigna al llenar; todavía no se pregunta nada.
   */
  awaiting?: { key: string; label: string }[];
}

export interface FlowPreview {
  steps: ResolvedStep[];
  /** Variables requeridas sin valor de las que depende alguna condición. */
  missing: string[];
}

export interface AskedSigner {
  signerId: string;
  name?: string;
  email?: string;
}

export const formatPdfUrl = (id: string) => `/api/bff/document-templates/${id}/pdf`;

export const fetchFormats = (all = false) =>
  apiClient.get<FormatSummary[]>(`/document-templates${all ? "?all=true" : ""}`);

export const fetchFormat = (id: string) => apiClient.get<FormatDetail>(`/document-templates/${id}`);

export const fetchFormatBpmn = async (id: string) => {
  const res = await fetch(`/api/bff/document-templates/${id}/bpmn`, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar el diagrama.");
  return res.text();
};

export function createFormat(file: File, draft: FormatDraft) {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("meta", JSON.stringify(draft));
  return apiClient.post<FormatDetail>("/document-templates", form);
}

/** Formato digital (sin PDF): con `id` regenera la hoja base mientras el formato no esté publicado. */
export const saveFormDocument = (draft: FormatDraft, id?: string) =>
  apiClient.post<FormatDetail>("/document-templates/form", id ? { ...draft, id } : draft);

export const updateFormat = (id: string, draft: FormatDraft) =>
  apiClient.put<FormatDetail>(`/document-templates/${id}`, draft);

export const setFormatPublished = (id: string, published: boolean) =>
  apiClient.post<FormatDetail>(`/document-templates/${id}/${published ? "publish" : "unpublish"}`);

export const deleteFormat = (id: string) => apiClient.delete<void>(`/document-templates/${id}`);

export const previewFormatFlow = (id: string, values: Record<string, string | number>) =>
  apiClient.post<FlowPreview>(`/document-templates/${id}/preview-flow`, { values });

export const instantiateFormat = (
  id: string,
  body: {
    values: Record<string, string | number>;
    askedSigners?: Record<string, AskedSigner>;
    /** Archivos ya subidos (staging) por especificación de anexo: `{ [specKey]: stagedId[] }`. */
    attachments?: Record<string, string[]>;
    folderId?: string;
    caseId?: string;
    title?: string;
  },
) =>
  apiClient.post<{ caseId: string; documentId: string; signatureRequestId: string; steps: ResolvedStep[] }>(
    `/document-templates/${id}/instantiate`,
    body,
  );

/* ───────── Anexos: carga previa (staging, caduca en 24 h) ───────── */

export interface StagedAttachment {
  stagedId: string;
  name: string;
  size: number;
  mime: string;
  sha256: string;
}

export interface UploadHandle {
  promise: Promise<StagedAttachment>;
  abort: () => void;
}

/** Sube un archivo a la zona previa. Usa XHR para poder mostrar el progreso (fetch no lo expone). */
export function uploadStagedAttachment(
  templateId: string,
  specKey: string,
  file: File,
  onProgress?: (percent: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<StagedAttachment>((resolve, reject) => {
    const url = `/api/bff/document-templates/${encodeURIComponent(templateId)}/attachments?specKey=${encodeURIComponent(specKey)}`;
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError("No hay conexión: no se pudo subir el archivo.", 0));
    xhr.onabort = () => reject(new ApiError("Carga cancelada.", 0));
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as StagedAttachment);
      if (xhr.status === 401 && typeof window !== "undefined") {
        window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
      }
      const message = (body as { message?: unknown } | undefined)?.message;
      reject(
        new ApiError(
          typeof message === "string" ? message : Array.isArray(message) ? message.join(" ") : `No se pudo subir el archivo (error ${xhr.status}).`,
          xhr.status,
          body,
        ),
      );
    };
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export const deleteStagedAttachment = (stagedId: string) =>
  apiClient.delete<void>(`/document-templates/attachments/staged/${encodeURIComponent(stagedId)}`);

export interface CaseAttachment {
  documentId: string;
  attachmentKey: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  hash: string;
}

export const fetchCaseAttachments = (caseId: string) =>
  apiClient.get<CaseAttachment[]>(`/cases/${encodeURIComponent(caseId)}/attachments`);

/* ───────── Flujos publicables (ProcessDefinition con `flow`) ───────── */

export interface FlowDefinition {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
  published: boolean;
  publishedAt: string | null;
  flow: Flow | null;
  bpmnXml: string;
  updatedAt: string;
}

export const fetchFlowDefinitions = (publishedOnly = false) =>
  apiClient.get<FlowDefinition[]>(`/process-definitions${publishedOnly ? "?published=true" : ""}`);

export const createFlowDefinition = (body: { name: string; description?: string; flow: Flow }) =>
  apiClient.post<FlowDefinition>("/process-definitions", body);

export const saveFlowDefinition = (key: string, body: { name?: string; description?: string; flow: Flow }) =>
  apiClient.put<FlowDefinition>(`/process-definitions/${encodeURIComponent(key)}/flow`, body);

export interface BpmnToFlowResult {
  /** `null` si el diagrama no se pudo convertir; los motivos van en `errors`. */
  flow: Flow | null;
  errors: string[];
  /** Valores completados por defecto (rol, participante, variables inferidas…). */
  warnings: string[];
}

/** Convierte el BPMN del modelador en un flujo ejecutable, sin guardarlo. */
export const convertBpmnToFlow = (xml: string, variables?: Flow["variables"]) =>
  apiClient.post<BpmnToFlowResult>("/flows/from-bpmn", { xml, variables });

export const setFlowPublished =(key: string, version: number, published: boolean) =>
  apiClient.post<FlowDefinition>(
    `/process-definitions/${encodeURIComponent(key)}/versions/${version}/${published ? "publish" : "unpublish"}`,
  );

/** Política de firma efectiva del tenant: los formatos solo pueden usar estos métodos. */
export const fetchSignaturePolicy = () => apiClient.get<{ allowedMethods: MethodName[] }>("/signature-requests/policy");
