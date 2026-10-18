import { apiClient } from "./api-client";
import type { Flow } from "@/libs/flow";
import type { FormatField, SignatureBox } from "./formats-service";

/** Hallazgo de la revisión de un flujo. `regla` se comprueba con código; `ia` es opinión de un modelo. */
export interface AiFinding {
  id: string;
  severity: "error" | "warn" | "info";
  title: string;
  detail: string;
  stepId?: string;
  source: "regla" | "ia";
}

export interface FlowProposal {
  /** `null` si la IA no logró un flujo válido; los motivos van en `errors`. */
  flow: Flow | null;
  errors: string[];
  warnings: string[];
  review: AiFinding[];
  meta: { model: string | null; attempts: number };
}

/** La IA propone; nada se guarda hasta que la persona lo revisa y lo guarda como siempre. */
export const proposeFlowFromText = (text: string) => apiClient.post<FlowProposal>("/ai/flows/from-text", { text });

export const reviewFlowWithAi = (flow: Flow, useAi: boolean) =>
  apiClient.post<{ findings: AiFinding[]; ai: boolean }>("/ai/flows/review", { flow, useAi });

export interface TemplateProposalMeta {
  name: string;
  description: string | null;
  category: string | null;
  fields: FormatField[];
  signatureBoxes: SignatureBox[];
  flow: Flow;
}

export interface TemplateProposal {
  meta: TemplateProposalMeta | null;
  errors: string[];
  warnings: string[];
  info: { model: string | null; attempts: number; candidates: number };
}

/** Solo funciona con PDFs que traen campos de formulario; al modelo no se le envía el contenido del PDF. */
export const proposeTemplateFromPdf = (file: File, description: string) => {
  const body = new FormData();
  body.append("file", file);
  if (description.trim()) body.append("description", description.trim());
  return apiClient.post<TemplateProposal>("/ai/templates/from-pdf", body);
};
