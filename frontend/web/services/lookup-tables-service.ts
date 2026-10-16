import { apiClient } from "./api-client";
import { MAX_PAGE_LIMIT, MAX_ROWS, rowsQueryString } from "@/libs/lookup";
import type {
  CellValue,
  LookupColumn,
  LookupQuery,
  LookupRow,
  LookupTable,
  LookupTableSummary,
  LookupTestResult,
  MoveBody,
  MoveResult,
  RowsFilters,
  RowsPage,
  RowsQuery,
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

export type RowValues = Record<string, CellValue>;

export const fetchLookupTables = () => apiClient.get<LookupTableSummary[]>(base);
export const fetchLookupTable = (tableId: string) => apiClient.get<LookupTable>(`${base}/${id(tableId)}`);
export const createLookupTable = (body: LookupTableInput) => apiClient.post<LookupTable>(base, body);
export const updateLookupTable = (tableId: string, body: LookupTablePatch) =>
  apiClient.put<LookupTable>(`${base}/${id(tableId)}`, body);
/** 409 si la usan formatos o flujos: el mensaje del error trae la lista. */
export const deleteLookupTable = (tableId: string) => apiClient.delete<void>(`${base}/${id(tableId)}`);

/** Una página de filas por cursor. `limit` se recorta a 1..200 (lo que acepta el BFF); `q` y `active` se resuelven en el servidor. */
export function fetchLookupRows(tableId: string, opts: RowsQuery = {}) {
  return apiClient.get<RowsPage>(`${base}/${id(tableId)}/rows?${rowsQueryString(opts)}`);
}

export interface FetchAllOptions extends Partial<RowsFilters> {
  /** Se llama tras cada página con lo cargado y el total. */
  onProgress?: (p: { loaded: number; total: number }) => void;
  /** Para cancelar entre página y página (lanza `AbortError`). */
  signal?: AbortSignal;
}

/**
 * Recorre TODAS las páginas por cursor (de 200 en 200, el máximo del BFF). Solo para lo que de verdad necesita la tabla
 * completa (exportar a CSV); la pantalla trabaja por páginas de 50.
 */
export async function fetchAllLookupRows(tableId: string, opts: FetchAllOptions = {}): Promise<LookupRow[]> {
  const all: LookupRow[] = [];
  let cursor: string | null = null;
  // Tope defensivo: 5000 filas / 200 + margen, por si el servidor devolviera un cursor que no avanza.
  const maxPages = Math.ceil(MAX_ROWS / MAX_PAGE_LIMIT) + 2;
  for (let i = 0; i < maxPages; i++) {
    if (opts.signal?.aborted) throw new DOMException("Exportación cancelada", "AbortError");
    const page: RowsPage = await fetchLookupRows(tableId, { cursor, limit: MAX_PAGE_LIMIT, q: opts.q, active: opts.active });
    all.push(...page.items);
    opts.onProgress?.({ loaded: all.length, total: page.total });
    if (!page.nextCursor || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

/** Reubica UNA fila sin reescribir toda la tabla: arriba/abajo, al inicio o detrás de otra (`null` = al inicio). */
export const moveLookupRow = (tableId: string, rowId: string, body: MoveBody) =>
  apiClient.post<MoveResult>(`${base}/${id(tableId)}/rows/${id(rowId)}/move`, body);
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
