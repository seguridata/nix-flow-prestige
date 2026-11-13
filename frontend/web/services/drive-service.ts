import { apiClient } from "./api-client";

export interface DriveFolder {
  id: string;
  name: string;
  parentId: string | null;
  itemCount: number;
}

export interface DriveCase {
  id: string;
  title: string;
  status: string;
  /** Documento suelto: expediente implícito que se muestra como documento. */
  loose: boolean;
  createdAt: string;
  documentCount: number;
  firstDocument: { id: string; filename: string; mimeType: string; sizeBytes: number } | null;
}

export interface DriveContents {
  folder: { id: string; name: string; parentId: string | null } | null;
  path: { id: string; name: string }[];
  folders: DriveFolder[];
  cases: DriveCase[];
}

export interface CaseOption {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  folderName: string | null;
  documentCount: number;
}

export const fetchDriveContents = (folderId: string | null) =>
  apiClient.get<DriveContents>(`/drive/contents${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`);

export const searchMyCases = (q: string) =>
  apiClient.get<CaseOption[]>(`/drive/cases${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);

export const createFolder = (body: { name: string; parentId: string | null }) =>
  apiClient.post<DriveFolder>("/drive/folders", { name: body.name, ...(body.parentId ? { parentId: body.parentId } : {}) });

export const updateFolder = (id: string, patch: { name?: string; parentId?: string | null }) =>
  apiClient.patch<DriveFolder>(`/drive/folders/${id}`, patch);

export const deleteFolder = (id: string) => apiClient.delete<void>(`/drive/folders/${id}`);

/** Copia un expediente o documento suelto a la carpeta destino (null = raíz). */
export const copyCase = (id: string, folderId: string | null) =>
  apiClient.post<{ id: string; title: string }>(`/drive/cases/${id}/copy`, { folderId });

/** Elimina un borrador; con firma, evidencia o comentarios el servidor responde 409. */
export const deleteCase = (id: string) => apiClient.delete<void>(`/drive/cases/${id}`);

export const updateCase = (id: string, patch: { title?: string; folderId?: string | null }) =>
  apiClient.patch<unknown>(`/cases/${id}`, patch);
