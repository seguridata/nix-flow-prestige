import { apiClient, ApiError } from "./api-client";
import type { DocumentRecord } from "@/libs/types";

export function fetchDocument(id: string) {
  return apiClient.get<DocumentRecord>(`/documents/${id}`);
}

/**
 * Descarga el PDF descifrado (vía proxy /api/bff, que adjunta el token) y
 * devuelve un object URL para `<embed>` / react-pdf. Quien lo recibe debe
 * hacer `URL.revokeObjectURL` al desmontar.
 */
export async function fetchDocumentObjectUrl(id: string): Promise<string> {
  const res = await fetch(`/api/bff/documents/${id}/content`, { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(`No se pudo cargar el documento (${res.status})`, res.status);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Alta de documento por multipart. El PDF nunca se serializa como base64. */
export function createDocument(params: { caseId: string; file: File; filename?: string }) {
  const form = new FormData();
  form.append("file", params.file, params.filename ?? params.file.name);
  form.append("caseId", params.caseId);
  if (params.filename) form.append("filename", params.filename);
  return apiClient.post<DocumentRecord>("/documents", form);
}
