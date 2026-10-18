import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Paginación por cursor común a todos los listados del BFF (P2).
 *
 * Contrato de la petición: `?limit=` (1..200, por defecto 50) y `?cursor=`
 * (id opaco: el `nextCursor` de la página anterior). El orden DEBE ser estable:
 * `createdAt desc, id desc` (ver `STABLE_ORDER`).
 *
 * COMPATIBILIDAD CON EL FRONTEND (importante): si la petición NO trae `limit`
 * ni `cursor` se devuelve el ARRAY plano como antes (con tope de
 * `LEGACY_ARRAY_CAP` = 200 filas en vez de ilimitado). Solo cuando trae `limit`
 * o `cursor` la respuesta es `{ items, nextCursor }`, donde `nextCursor` es
 * `null` en la última página. Así los clientes actuales no se rompen y los
 * nuevos migran a cursor cuando quieran.
 */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;
export const LEGACY_ARRAY_CAP = 200;

/** Orden estable requerido para que el cursor por id sea determinista. */
export const STABLE_ORDER = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @IsOptional() @IsString() @MaxLength(200)
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PageArgs {
  /** true si la petición trajo `limit` o `cursor` → respuesta `{items,nextCursor}`. */
  paged: boolean;
  limit: number;
  cursor?: string;
}

export function pageArgs(q?: { limit?: number; cursor?: string }): PageArgs {
  const paged = q?.limit !== undefined || (q?.cursor !== undefined && q.cursor !== '');
  if (!paged) return { paged: false, limit: LEGACY_ARRAY_CAP };
  const raw = q?.limit ?? DEFAULT_PAGE_LIMIT;
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(raw) || DEFAULT_PAGE_LIMIT));
  return { paged: true, limit, cursor: q?.cursor || undefined };
}

/** take/skip/cursor de Prisma. En modo paginado pide una fila extra para saber si hay más. */
export function prismaPage(a: PageArgs): { take: number; skip?: number; cursor?: { id: string } } {
  if (!a.paged) return { take: a.limit };
  return {
    take: a.limit + 1,
    ...(a.cursor ? { cursor: { id: a.cursor }, skip: 1 } : {}),
  };
}

/** Da forma a la respuesta: array plano (compat) u objeto `{items,nextCursor}`. */
export function finishPage<T extends { id: string }>(rows: T[], a: PageArgs): T[] | Page<T> {
  if (!a.paged) return rows;
  const hasMore = rows.length > a.limit;
  const items = hasMore ? rows.slice(0, a.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/** Aplica `fn` a cada elemento conservando la forma (array compat u objeto paginado). */
export function mapPage<T, U>(result: T[] | Page<T>, fn: (row: T) => U): U[] | Page<U> {
  return Array.isArray(result)
    ? result.map(fn)
    : { items: result.items.map(fn), nextCursor: result.nextCursor };
}
