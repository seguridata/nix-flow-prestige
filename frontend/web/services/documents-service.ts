import { apiClient } from "./api-client";
import type { DocumentRecord } from "@/libs/types";

export function fetchDocument(id: string) {
  return apiClient.get<DocumentRecord>(`/documents/${id}`);
}

export function fetchDocumentContent(id: string) {
  return apiClient.get<{ id: string; hash: string; contentBase64: string }>(
    `/documents/${id}/content`,
  );
}

export function createDocument(body: { caseId: string; filename: string; contentBase64: string }) {
  return apiClient.post<DocumentRecord>("/documents", body);
}
