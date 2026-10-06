import { apiClient } from "./api-client";
import type { CaseRecord } from "@/libs/types";

/**
 * El tenant y el dueño salen del token en el BFF. `folderId` ubica el expediente en "Mis documentos";
 * `loose` crea el expediente implícito de un documento suelto.
 */
export function createCase(body: { title: string; folderId?: string | null; loose?: boolean }) {
  return apiClient.post<CaseRecord>("/cases", {
    title: body.title,
    ...(body.folderId ? { folderId: body.folderId } : {}),
    ...(body.loose ? { loose: true } : {}),
  });
}

export function fetchCase(id: string) {
  return apiClient.get<CaseRecord>(`/cases/${id}`);
}
