import { apiClient } from "./api-client";
import type {
  CellValue,
  LookupColumn,
  LookupQuery,
  LookupRow,
  LookupTable,
  LookupTableSummary,
  LookupTestResult,
} from "@/libs/lookup";

/** Endpoints de ADR-008 §6. Todos son solo para administradores: no hay consulta pública. */
const base = "/lookup-tables";
const id = (v: string) => encodeURIComponent(v);

export interface LookupTableInput {
  key: string;
  name: string;
  description?: string;
  columns: LookupColumn[];
}

export type LookupTablePatch = Partial<Pick<LookupTableInput, "name" | "description" | "columns">> & { active?: boolean };

export interface RowsPage {
  items: LookupRow[];
  nextCursor: string | null;
}

export type RowValues = Record<string, CellValue>;

export const fetchLookupTables = () => apiClient.get<LookupTableSummary[]>(base);
export const fetchLookupTable = (tableId: string) => apiClient.get<LookupTable>(`${base}/${id(tableId)}`);
export const createLookupTable = (body: LookupTableInput) => apiClient.post<LookupTable>(base, body);
export const updateLookupTable = (tableId: string, body: LookupTablePatch) =>
  apiClient.put<LookupTable>(`${base}/${id(tableId)}`, body);
/** 409 si la usan formatos o flujos: el mensaje del error trae la lista. */
export const deleteLookupTable = (tableId: string) => apiClient.delete<void>(`${base}/${id(tableId)}`);

export function fetchLookupRows(tableId: string, opts: { cursor?: string | null; limit?: number; q?: string } = {}) {
  const p = new URLSearchParams();
  if (opts.cursor) p.set("cursor", opts.cursor);
  if (opts.limit) p.set("limit", String(opts.limit));
  if (opts.q?.trim()) p.set("q", opts.q.trim());
  const qs = p.toString();
  return apiClient.get<RowsPage>(`${base}/${id(tableId)}/rows${qs ? `?${qs}` : ""}`);
}

/** Recorre todas las páginas (hasta 5000 filas): el orden de las filas decide cuál gana, así que se necesita completo. */
export async function fetchAllLookupRows(tableId: string, pageSize = 500): Promise<LookupRow[]> {
  const all: LookupRow[] = [];
  let cursor: string | null = null;
  // Tope defensivo: 5000 filas / pageSize + margen, por si el servidor devolviera un cursor que no avanza.
  for (let i = 0; i < 50; i++) {
    const page: RowsPage = await fetchLookupRows(tableId, { cursor, limit: pageSize });
    all.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

export const createLookupRow = (tableId: string, values: RowValues) =>
  apiClient.post<LookupRow>(`${base}/${id(tableId)}/rows`, { values });

export const updateLookupRow = (tableId: string, rowId: string, patch: { values?: RowValues; active?: boolean }) =>
  apiClient.put<LookupRow>(`${base}/${id(tableId)}/rows/${id(rowId)}`, patch);

export const deleteLookupRow = (tableId: string, rowId: string) =>
  apiClient.delete<void>(`${base}/${id(tableId)}/rows/${id(rowId)}`);

export const reorderLookupRows = (tableId: string, ids: string[]) =>
  apiClient.post<unknown>(`${base}/${id(tableId)}/rows/reorder`, { ids });

/** Todo o nada. `replace` borra las filas existentes de la tabla (solo del tenant) antes de cargar. */
export const importLookupRows = (tableId: string, rows: RowValues[], replace: boolean) =>
  apiClient.post<unknown>(`${base}/${id(tableId)}/rows/import`, { rows, replace });

export const testLookupQuery = (tableId: string, query: LookupQuery, inputs: Record<string, CellValue> = {}) =>
  apiClient.post<LookupTestResult>(`${base}/${id(tableId)}/test`, { query, inputs });
