import { apiClient } from "./api-client";
import type { Flow, FlowStep, VarType } from "@/libs/flow";

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
}

export interface FormatDetail {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  published: boolean;
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
    folderId?: string;
    caseId?: string;
    title?: string;
  },
) =>
  apiClient.post<{ caseId: string; documentId: string; signatureRequestId: string; steps: ResolvedStep[] }>(
    `/document-templates/${id}/instantiate`,
    body,
  );

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

export const setFlowPublished = (key: string, version: number, published: boolean) =>
  apiClient.post<FlowDefinition>(
    `/process-definitions/${encodeURIComponent(key)}/versions/${version}/${published ? "publish" : "unpublish"}`,
  );

/** Política de firma efectiva del tenant: los formatos solo pueden usar estos métodos. */
export const fetchSignaturePolicy = () => apiClient.get<{ allowedMethods: MethodName[] }>("/signature-requests/policy");
