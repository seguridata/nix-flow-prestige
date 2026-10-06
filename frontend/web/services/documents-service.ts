import { apiClient } from "./api-client";
import type { DocumentRecord } from "@/libs/types";

export function fetchDocument(id: string) {
  return apiClient.get<DocumentRecord>(`/documents/${id}`);
}

/**
 * El contenido del PDF se sirve por su URL same-origin
 * `/api/bff/documents/:id/content` (el proxy adjunta el token). Los visores
 * (`<object>`, react-pdf) la consumen directo: sin blob en memoria que
 * revocar, sin el lector XHR de pdf.js.
 */
export const documentContentUrl = (id: string) => `/api/bff/documents/${id}/content`;

/** Alta de documento por multipart. El PDF nunca se serializa como base64. */
export function createDocument(params: { caseId: string; file: File; filename?: string }) {
  const form = new FormData();
  form.append("file", params.file, params.filename ?? params.file.name);
  form.append("caseId", params.caseId);
  if (params.filename) form.append("filename", params.filename);
  return apiClient.post<DocumentRecord>("/documents", form);
}

/** Documentos de un expediente (sin paginar: un expediente tiene pocos). */
export function fetchCaseDocuments(caseId: string) {
  return apiClient.get<DocumentRecord[]>(`/documents?caseId=${encodeURIComponent(caseId)}`);
}
