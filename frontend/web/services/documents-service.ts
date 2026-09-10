import { apiClient, ApiError } from "./api-client";
import type { DocumentRecord } from "@/libs/types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export function fetchDocument(id: string) {
  return apiClient.get<DocumentRecord>(`/documents/${id}`);
}

/**
 * Descarga el PDF descifrado desde el BFF y devuelve un object URL listo para
 * `<embed>` / react-pdf. Quien lo recibe debe hacer `URL.revokeObjectURL` al
 * desmontar.
 */
export async function fetchDocumentObjectUrl(id: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/documents/${id}/content`, { credentials: "include" });
  if (!res.ok) {
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
