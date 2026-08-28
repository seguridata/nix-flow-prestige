import { apiClient } from "./api-client";
import type { SignatureField, SignatureFieldType } from "@/libs/types";

export interface SignatureFieldDraft {
  signerId: string;
  type: SignatureFieldType;
  page: number;
  /** Coordenadas normalizadas 0..1 relativas a la página renderizada. */
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required: boolean;
}

export function fetchFields(documentId: string) {
  return apiClient.get<SignatureField[]>(
    `/signature-fields?documentId=${encodeURIComponent(documentId)}`,
  );
}

/**
 * Reemplaza de forma atómica todos los campos de un documento por el
 * conjunto actual del editor (agregar/mover/borrar se resuelve con un solo
 * guardado idempotente).
 */
export function bulkCreateFields(documentId: string, fields: SignatureFieldDraft[]) {
  return apiClient.post<SignatureField[]>("/signature-fields/bulk", {
    documentId,
    fields,
  });
}
