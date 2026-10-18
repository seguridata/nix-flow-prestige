import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LookupRow, LookupTable } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditChainService } from '../collaboration/audit-chain.service';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../common/pagination';
import { flowQueries, isObj, validateLookupQuery } from '../flow/flow';
import type { Flow, LookupQuery } from '../flow/flow.types';
import { dryRun, normText, type LookupColumn } from './lookup-engine';
import {
  MAX_ROWS,
  checkQueryAgainstColumns,
  cleanText,
  isValidTableKey,
  parseColumns,
  parseInputs,
  parseRowValues,
  type RowValues,
} from './lookup-validation';

export interface LookupActor {
  /** SLUG del tenant (el que deja el guard), nunca el uuid de la membresía. */
  tenantId: string;
  actorId: string;
  name?: string;
}

export interface TableView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  columns: LookupColumn[];
  revision: number;
  active: boolean;
  rowCount: number;
}

export interface RowView {
  id: string;
  values: RowValues;
  position: number;
  active: boolean;
}

export interface RowsFilter {
  limit?: number;
  cursor?: string;
  q?: string;
  active?: boolean;
}

export interface MoveResult {
  id: string;
  /** false si ya estaba en el extremo (o en el lugar pedido): no se escribió ni auditó nada. */
  moved: boolean;
  /** Lugar de la fila en el orden de evaluación de TODA la tabla, empezando en 1. */
  index: number;
  position: number;
  total: number;
  revision: number;
  /** Filas cuya `position` cambió (solo las afectadas). */
  changed: { id: string; position: number }[];
}

/** Quién usa una tabla: formatos (DocumentTemplate.flow) y definiciones de proceso (ProcessDefinition.flow) del tenant. */
export interface TableReferences {
  templates: { id: string; name: string }[];
  definitions: { key: string; version: number; name: string }[];
}

interface Ref {
  kind: 'template' | 'definition';
  id: string;
  name: string;
  version?: number;
  columns: Set<string>;
}

// Búsqueda sin acentos en SQL sin la extensión `unaccent` (no hay migraciones aquí): se pliegan las vocales acentuadas, ñ y ç.
const ACCENT_PAIRS: [string, string][] = [
  ['áàäâãå', 'a'],
  ['éèëê', 'e'],
  ['íìïî', 'i'],
  ['óòöôõ', 'o'],
  ['úùüû', 'u'],
  ['ñ', 'n'],
  ['ç', 'c'],
];
const foldPairs = ACCENT_PAIRS.flatMap(([chars, to]) => [...chars, ...chars.toUpperCase()].map((c) => [c, to] as const));
const ACCENT_FROM = foldPairs.map(([c]) => c).join('');
const ACCENT_TO = foldPairs.map(([, t]) => t).join('');

const MAX_ERRORS = 50;
const MAX_AUDIT_POSITIONS = 50;
const MAX_LIST = 500;

const toColumns = (json: Prisma.JsonValue): LookupColumn[] => (Array.isArray(json) ? (json as unknown as LookupColumn[]) : []);
const toValues = (json: Prisma.JsonValue): RowValues => (isObj(json) ? (json as RowValues) : {});

const toRow = (r: Pick<LookupRow, 'id' | 'values' | 'position' | 'active'>): RowView => ({
  id: r.id,
  values: toValues(r.values),
  position: r.position,
  active: r.active,
});

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** CRUD de tablas de consulta y de sus filas (ADR-008 §3 y §6). TODO acotado al `tenantId` del guard. */
@Injectable()
export class LookupTablesService {
  private readonly log = new Logger(LookupTablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditChainService,
  ) {}

  /** Auditoría sin valores de celdas: ids, claves y conteos. Un fallo de la cadena se registra, no tumba la operación. */
  private async record(actor: LookupActor, action: string, payload: Record<string, unknown>) {
    try {
      await this.audit.append({ tenantId: actor.tenantId, actorId: actor.actorId, actorName: actor.name, action, payload });
    } catch (e) {
      this.log.error(`No se pudo registrar ${action} en la auditoría: ${(e as Error).message}`);
    }
  }

  private async table(id: string, tenantId: string): Promise<LookupTable> {
    const t = await this.prisma.lookupTable.findFirst({ where: { id, tenantId } });
    if (!t) throw new NotFoundException('Tabla de consulta no encontrada');
    return t;
  }

  private view(t: LookupTable, rowCount: number): TableView {
    return {
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description,
      columns: toColumns(t.columns),
      revision: t.revision,
      active: t.active,
      rowCount,
    };
  }

  // ───────────────────────────── tablas ─────────────────────────────

  async list(tenantId: string): Promise<TableView[]> {
    const tables = await this.prisma.lookupTable.findMany({
      where: { tenantId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: MAX_LIST,
      include: { _count: { select: { rows: true } } },
    });
    return tables.map((t) => this.view(t, t._count.rows));
  }

  async get(id: string, tenantId: string): Promise<TableView> {
    const t = await this.table(id, tenantId);
    return this.view(t, await this.prisma.lookupRow.count({ where: { tableId: id, tenantId } }));
  }

  async create(raw: unknown, actor: LookupActor): Promise<TableView> {
    const body = isObj(raw) ? raw : {};
    const errors: string[] = [];
    if (!isValidTableKey(body.key)) errors.push('La clave de la tabla debe usar minúsculas, números, guion y guion bajo (máx. 60)');
    const name = cleanText(body.name, 'Nombre', 120, errors, true);
    const description = cleanText(body.description, 'Descripción', 500, errors, false);
    const cols = parseColumns(body.columns);
    errors.push(...cols.errors);
    if (errors.length) throw new BadRequestException({ message: 'La tabla no es válida', errors });

    const key = body.key as string;
    const clash = await this.prisma.lookupTable.findFirst({ where: { tenantId: actor.tenantId, key }, select: { id: true } });
    if (clash) throw new ConflictException(`Ya existe una tabla con la clave «${key}»`);
    const created = await this.prisma.lookupTable.create({
      data: {
        tenantId: actor.tenantId,
        key,
        name: name!,
        description,
        columns: cols.columns as unknown as Prisma.InputJsonValue,
        createdBy: actor.actorId,
      },
    });
    await this.record(actor, 'LOOKUP_TABLE_CREATED', { tableId: created.id, key, columnKeys: cols.columns!.map((c) => c.key), revision: created.revision });
    return this.view(created, 0);
  }

  async update(id: string, raw: unknown, actor: LookupActor): Promise<TableView> {
    const current = await this.table(id, actor.tenantId);
    const body = isObj(raw) ? raw : {};
    const errors: string[] = [];
    const data: Prisma.LookupTableUpdateManyMutationInput = {};
    const changed: string[] = [];

    if (body.name !== undefined) {
      const name = cleanText(body.name, 'Nombre', 120, errors, true);
      if (name && name !== current.name) {
        data.name = name;
        changed.push('name');
      }
    }
    if (body.description !== undefined) {
      const d = cleanText(body.description, 'Descripción', 500, errors, false);
      if (d !== current.description) {
        data.description = d;
        changed.push('description');
      }
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') errors.push('active debe ser verdadero o falso');
      else if (body.active !== current.active) {
        data.active = body.active;
        changed.push('active');
      }
    }
    const oldCols = toColumns(current.columns);
    let newCols: LookupColumn[] | undefined;
    if (body.columns !== undefined) {
      const parsed = parseColumns(body.columns);
      errors.push(...parsed.errors);
      if (parsed.columns && !sameJson(parsed.columns, oldCols)) newCols = parsed.columns;
    }
    if (errors.length) throw new BadRequestException({ message: 'La tabla no es válida', errors });

    if (newCols) {
      await this.assertColumnChangeSafe(current, oldCols, newCols, actor.tenantId);
      changed.push('columns');
    }
    if (!changed.length) return this.get(id, actor.tenantId);

    const removed = newCols ? oldCols.filter((c) => !newCols!.some((n) => n.key === c.key)).map((c) => c.key) : [];
    const revision = await this.prisma.$transaction(async (tx) => {
      if (newCols) {
        data.columns = newCols as unknown as Prisma.InputJsonValue;
        data.revision = { increment: 1 };
        // Las claves de columnas quitadas ya no tienen dónde vivir: se limpian de las filas de ESTA tabla del tenant.
        if (removed.length) {
          await tx.$executeRaw`UPDATE "LookupRow" SET "values" = "values" - ${removed}::text[], "updatedAt" = now() WHERE "tableId" = ${id} AND "tenantId" = ${actor.tenantId}`;
        }
      }
      const res = await tx.lookupTable.updateMany({ where: { id, tenantId: actor.tenantId }, data });
      if (res.count === 0) throw new NotFoundException('Tabla de consulta no encontrada');
      const fresh = await tx.lookupTable.findFirst({ where: { id, tenantId: actor.tenantId }, select: { revision: true } });
      return fresh?.revision ?? current.revision;
    });
    await this.record(actor, 'LOOKUP_TABLE_UPDATED', {
      tableId: id,
      key: current.key,
      changed,
      ...(newCols ? { columnKeys: newCols.map((c) => c.key), removedColumnKeys: removed } : {}),
      revision,
    });
    return this.get(id, actor.tenantId);
  }

  /**
   * Cambiar columnas no puede dejar filas con valores que ya no valen ni flujos citando columnas que ya no existen o cambiaron
   * de tipo. En esos casos responde 409 / 400 con lo que hay que corregir primero.
   */
  private async assertColumnChangeSafe(table: LookupTable, oldCols: LookupColumn[], newCols: LookupColumn[], tenantId: string) {
    const newByKey = new Map(newCols.map((c) => [c.key, c]));
    const broken = new Set<string>();
    for (const o of oldCols) {
      const n = newByKey.get(o.key);
      if (!n || n.type !== o.type) broken.add(o.key);
    }
    if (broken.size) {
      const refs = (await this.refs(tenantId, table.key)).filter((r) => [...r.columns].some((c) => broken.has(c)));
      if (refs.length) {
        throw new ConflictException({
          message: 'Hay formatos o flujos que usan columnas que quitas o cuyo tipo cambias; corrígelos primero',
          columns: [...broken],
          ...this.shape(refs),
        });
      }
    }
    // Las filas deben seguir siendo válidas con las columnas nuevas (las columnas quitadas se limpian, no cuentan).
    const kept = newCols.filter((n) => oldCols.some((o) => o.key === n.key));
    const changedKeys = new Set(
      kept.filter((n) => !sameJson(n, oldCols.find((o) => o.key === n.key))).map((n) => n.key),
    );
    if (!changedKeys.size) return;
    const rows = await this.prisma.lookupRow.findMany({ where: { tableId: table.id, tenantId }, select: { id: true, values: true }, take: MAX_ROWS });
    const errors: string[] = [];
    const only = newCols.filter((c) => changedKeys.has(c.key));
    rows.forEach((r, i) => {
      const values = toValues(r.values);
      const subset = Object.fromEntries(Object.entries(values).filter(([k]) => changedKeys.has(k)));
      const res = parseRowValues(subset, only, `Fila ${i + 1}`);
      if (res.errors.length && errors.length < MAX_ERRORS) errors.push(...res.errors.slice(0, 3));
    });
    if (errors.length) {
      throw new BadRequestException({ message: 'Hay filas con valores que no valen con las columnas nuevas; corrígelas primero', errors: errors.slice(0, MAX_ERRORS) });
    }
  }

  async remove(id: string, actor: LookupActor): Promise<void> {
    const t = await this.table(id, actor.tenantId);
    const refs = await this.refs(actor.tenantId, t.key);
    if (refs.length) throw new ConflictException({ message: 'La tabla está en uso y no se puede borrar', ...this.shape(refs) });
    const rowCount = await this.prisma.lookupRow.count({ where: { tableId: id, tenantId: actor.tenantId } });
    // Las filas caen en cascada (FK). Se filtra por tenant en la escritura aunque `table()` ya lo comprobó.
    const res = await this.prisma.lookupTable.deleteMany({ where: { id, tenantId: actor.tenantId } });
    if (res.count === 0) throw new NotFoundException('Tabla de consulta no encontrada');
    await this.record(actor, 'LOOKUP_TABLE_DELETED', { tableId: id, key: t.key, rowCount });
  }

  /** Formatos y definiciones del tenant que citan la tabla (por su `key`) y qué columnas usan. */
  private async refs(tenantId: string, key: string): Promise<Ref[]> {
    const [templates, definitions] = await Promise.all([
      this.prisma.documentTemplate.findMany({ where: { tenantId }, select: { id: true, name: true, flow: true } }),
      this.prisma.processDefinition.findMany({ where: { tenantId }, select: { id: true, key: true, name: true, version: true, flow: true } }),
    ]);
    const out: Ref[] = [];
    const scan = (flowJson: unknown): Set<string> | null => {
      if (!isObj(flowJson) || !Array.isArray(flowJson.steps)) return null;
      const cols = new Set<string>();
      let cited = false;
      try {
        for (const q of flowQueries(flowJson as unknown as Flow)) {
          if (q.query?.table !== key) continue;
          cited = true;
          q.query.match?.forEach((c) => cols.add(c.column));
          q.columns.forEach((c) => cols.add(c));
        }
      } catch {
        return null; // un flujo con forma rota no cita nada que se pueda leer
      }
      return cited ? cols : null;
    };
    for (const t of templates) {
      const cols = scan(t.flow);
      if (cols) out.push({ kind: 'template', id: t.id, name: t.name, columns: cols });
    }
    for (const d of definitions) {
      const cols = scan(d.flow);
      if (cols) out.push({ kind: 'definition', id: d.key, name: d.name, version: d.version, columns: cols });
    }
    return out;
  }

  private shape(refs: Ref[]): TableReferences {
    return {
      templates: refs.filter((r) => r.kind === 'template').map((r) => ({ id: r.id, name: r.name })),
      definitions: refs.filter((r) => r.kind === 'definition').map((r) => ({ key: r.id, version: r.version!, name: r.name })),
    };
  }

  // ───────────────────────────── filas ─────────────────────────────

  /** Cursor opaco `position:id`: sigue valiendo aunque la fila que lo originó se borre o se mueva. Un id suelto también se acepta. */
  private async cursorKey(tableId: string, tenantId: string, cursor: string): Promise<{ position: number; id: string }> {
    const m = /^(-?\d{1,9}):(.+)$/.exec(cursor);
    if (m) return { position: Number(m[1]), id: m[2]! };
    const row = await this.prisma.lookupRow.findFirst({ where: { id: cursor, tableId, tenantId }, select: { id: true, position: true } });
    if (!row) throw new BadRequestException('El cursor no es válido');
    return { position: row.position, id: row.id };
  }

  /**
   * Filas por cursor en orden de evaluación (`position` asc, desempate por `id`), con `total` = filas que cumplen los filtros
   * (no solo las de la página). Filtros: `active` y `q` (texto en las celdas, sin mayúsculas ni acentos).
   *
   * `q` va en SQL sobre `jsonb_each_text("values")`, acotado a (tenantId, tableId) con el índice existente: recorre como mucho
   * las 5000 filas de UNA tabla y `q` mide ≤ 100. Un índice trigram (pg_trgm) no aplica a «cualquier celda» sin una columna
   * generada, así que no se crea; si las tablas crecieran habría que revisarlo (ver ADR-008 §10).
   */
  async listRows(id: string, filter: RowsFilter, tenantId: string): Promise<{ items: RowView[]; nextCursor: string | null; total: number }> {
    await this.table(id, tenantId);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(filter.limit ?? DEFAULT_PAGE_LIMIT) || DEFAULT_PAGE_LIMIT));
    const q = normText(filter.q ?? '');
    const key = filter.cursor ? await this.cursorKey(id, tenantId, filter.cursor) : null;

    let rows: RowView[];
    let total: number;
    if (!q) {
      const base: Prisma.LookupRowWhereInput = { tableId: id, tenantId, ...(filter.active === undefined ? {} : { active: filter.active }) };
      const where: Prisma.LookupRowWhereInput = key
        ? { ...base, OR: [{ position: { gt: key.position } }, { position: key.position, id: { gt: key.id } }] }
        : base;
      const [found, count] = await Promise.all([
        this.prisma.lookupRow.findMany({ where, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: limit + 1 }),
        this.prisma.lookupRow.count({ where: base }),
      ]);
      rows = found.map(toRow);
      total = count;
    } else {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      const active = filter.active === undefined ? Prisma.empty : Prisma.sql`AND r."active" = ${filter.active}`;
      const match = Prisma.sql`r."tableId" = ${id} AND r."tenantId" = ${tenantId} ${active}
        AND EXISTS (SELECT 1 FROM jsonb_each_text(r."values") AS e WHERE translate(lower(e."value"), ${Prisma.raw(`'${ACCENT_FROM}'`)}, ${Prisma.raw(`'${ACCENT_TO}'`)}) LIKE ${like} ESCAPE '\\')`;
      const after = key ? Prisma.sql`AND (r."position", r."id") > (${key.position}::int, ${key.id})` : Prisma.empty;
      const [counted, found] = await Promise.all([
        this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "LookupRow" r WHERE ${match}`),
        this.prisma.$queryRaw<Pick<LookupRow, 'id' | 'values' | 'position' | 'active'>[]>(
          Prisma.sql`SELECT r."id", r."values", r."position", r."active" FROM "LookupRow" r WHERE ${match} ${after} ORDER BY r."position" ASC, r."id" ASC LIMIT ${limit + 1}::int`,
        ),
      ]);
      rows = found.map(toRow);
      total = Number(counted[0]?.n ?? 0);
    }

    const more = rows.length > limit;
    const items = more ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return { items, nextCursor: more && last ? `${last.position}:${last.id}` : null, total };
  }

  async createRow(id: string, raw: unknown, actor: LookupActor): Promise<RowView> {
    const table = await this.table(id, actor.tenantId);
    const body = isObj(raw) ? raw : {};
    const parsed = parseRowValues(body.values, toColumns(table.columns), 'Fila');
    if (!parsed.values) throw new BadRequestException({ message: 'La fila no es válida', errors: parsed.errors });
    const { row, revision } = await this.prisma.$transaction(async (tx) => {
      const count = await tx.lookupRow.count({ where: { tableId: id, tenantId: actor.tenantId } });
      if (count >= MAX_ROWS) throw new BadRequestException(`La tabla admite máximo ${MAX_ROWS} filas`);
      const max = await tx.lookupRow.aggregate({ where: { tableId: id, tenantId: actor.tenantId }, _max: { position: true } });
      const created = await tx.lookupRow.create({
        data: { tenantId: actor.tenantId, tableId: id, values: parsed.values as unknown as Prisma.InputJsonValue, position: (max._max.position ?? -1) + 1 },
      });
      return { row: created, revision: await this.bump(tx, id, actor.tenantId) };
    });
    await this.record(actor, 'LOOKUP_ROW_CREATED', { tableId: id, tableKey: table.key, rowId: row.id, revision });
    return toRow(row);
  }

  async updateRow(id: string, rowId: string, raw: unknown, actor: LookupActor): Promise<RowView> {
    const table = await this.table(id, actor.tenantId);
    const row = await this.prisma.lookupRow.findFirst({ where: { id: rowId, tableId: id, tenantId: actor.tenantId } });
    if (!row) throw new NotFoundException('Fila no encontrada');
    const body = isObj(raw) ? raw : {};
    if (body.active !== undefined && typeof body.active !== 'boolean') throw new BadRequestException('active debe ser verdadero o falso');

    const data: Prisma.LookupRowUpdateManyMutationInput = {};
    let changedColumns: string[] = [];
    let values = toValues(row.values);
    if (body.values !== undefined) {
      // `values` reemplaza la fila completa (lo que no venga queda vacío = «cualquiera»).
      const parsed = parseRowValues(body.values, toColumns(table.columns), 'Fila');
      if (!parsed.values) throw new BadRequestException({ message: 'La fila no es válida', errors: parsed.errors });
      changedColumns = [...new Set([...Object.keys(values), ...Object.keys(parsed.values)])].filter((k) => !sameJson(values[k], parsed.values![k]));
      values = parsed.values;
      if (changedColumns.length) data.values = values as unknown as Prisma.InputJsonValue;
    }
    const activeChanged = body.active !== undefined && body.active !== row.active;
    if (activeChanged) data.active = body.active as boolean;
    if (!changedColumns.length && !activeChanged) return toRow(row);

    const revision = await this.prisma.$transaction(async (tx) => {
      const res = await tx.lookupRow.updateMany({ where: { id: rowId, tableId: id, tenantId: actor.tenantId }, data });
      if (res.count === 0) throw new NotFoundException('Fila no encontrada');
      return this.bump(tx, id, actor.tenantId);
    });
    await this.record(actor, 'LOOKUP_ROW_UPDATED', {
      tableId: id,
      tableKey: table.key,
      rowId,
      changedColumns,
      ...(activeChanged ? { active: body.active } : {}),
      revision,
    });
    return { id: rowId, values, position: row.position, active: activeChanged ? (body.active as boolean) : row.active };
  }

  async removeRow(id: string, rowId: string, actor: LookupActor): Promise<void> {
    const table = await this.table(id, actor.tenantId);
    const revision = await this.prisma.$transaction(async (tx) => {
      const res = await tx.lookupRow.deleteMany({ where: { id: rowId, tableId: id, tenantId: actor.tenantId } });
      if (res.count === 0) throw new NotFoundException('Fila no encontrada');
      return this.bump(tx, id, actor.tenantId);
    });
    await this.record(actor, 'LOOKUP_ROW_DELETED', { tableId: id, tableKey: table.key, rowId, revision });
  }

  /**
   * Fija el orden de evaluación. `ids` (sin repetir, todos de esta tabla) van primero y en ese orden; las filas que no se
   * mencionen siguen después con su orden actual. Las posiciones se renumeran 0..n-1.
   */
  async reorder(id: string, ids: unknown, actor: LookupActor) {
    const table = await this.table(id, actor.tenantId);
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== 'string')) throw new BadRequestException('Envía la lista de ids de fila');
    if (ids.length > MAX_ROWS) throw new BadRequestException(`Máximo ${MAX_ROWS} filas`);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('La lista trae ids repetidos');
    const all = await this.prisma.lookupRow.findMany({
      where: { tableId: id, tenantId: actor.tenantId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: MAX_ROWS,
    });
    const known = new Set(all.map((r) => r.id));
    const foreign = (ids as string[]).filter((x) => !known.has(x));
    if (foreign.length) throw new BadRequestException({ message: 'Hay filas que no son de esta tabla', errors: foreign.slice(0, MAX_ERRORS).map((x) => `Fila ${x}: no existe en la tabla`) });
    const listed = new Set(ids as string[]);
    const order = [...(ids as string[]), ...all.map((r) => r.id).filter((x) => !listed.has(x))];
    const positions = order.map((_, i) => i);

    const revision = await this.prisma.$transaction(async (tx) => {
      await this.writePositions(tx, id, actor.tenantId, order, positions);
      return this.bump(tx, id, actor.tenantId);
    });
    await this.record(actor, 'LOOKUP_ROWS_REORDERED', { tableId: id, tableKey: table.key, count: order.length, revision });
    return { reordered: order.length, revision };
  }

  /** Escribe `position` SOLO de las filas dadas (una sentencia), acotado a la tabla y al tenant. */
  private async writePositions(tx: Prisma.TransactionClient, tableId: string, tenantId: string, ids: string[], positions: number[]) {
    if (!ids.length) return;
    await tx.$executeRaw`UPDATE "LookupRow" AS r SET "position" = u."pos", "updatedAt" = now() FROM unnest(${ids}::text[], ${positions}::int[]) AS u("id", "pos") WHERE r."id" = u."id" AND r."tableId" = ${tableId} AND r."tenantId" = ${tenantId}`;
  }

  /**
   * Reubica UNA fila: `{direction:'up'|'down'}`, `{toTop:true}` o `{afterRowId:id|null}` (null = al inicio). En una transacción que
   * bloquea la tabla (`FOR UPDATE`, así dos movimientos simultáneos se serializan y ninguno pisa al otro) se leen solo `id` y
   * `position` y se recalculan las posiciones únicamente de la ventana entre el origen y el destino: reutilizando los mismos
   * valores de `position` de esa ventana, sin tocar el resto. Si la ventana trae posiciones repetidas (no debería) se renumera 0..n-1.
   */
  async moveRow(id: string, rowId: string, raw: unknown, actor: LookupActor): Promise<MoveResult> {
    const table = await this.table(id, actor.tenantId);
    const body = isObj(raw) ? raw : {};
    const given = (['direction', 'toTop', 'afterRowId'] as const).filter((k) => body[k] !== undefined);
    if (given.length !== 1) throw new BadRequestException('Indica una sola forma de mover: direction, toTop o afterRowId');
    const mode = given[0]!;
    if (mode === 'direction' && body.direction !== 'up' && body.direction !== 'down') throw new BadRequestException('direction debe ser «up» o «down»');
    if (mode === 'toTop' && body.toTop !== true) throw new BadRequestException('toTop solo admite true');
    if (mode === 'afterRowId' && body.afterRowId !== null && (typeof body.afterRowId !== 'string' || body.afterRowId === '')) {
      throw new BadRequestException('afterRowId debe ser el id de una fila o null (al inicio)');
    }

    const orderBy = [{ position: 'asc' as const }, { id: 'asc' as const }];
    const done = await this.prisma.$transaction(async (tx): Promise<{ result: MoveResult; from: number; to: number; fromPosition: number }> => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "LookupTable" WHERE "id" = ${id} AND "tenantId" = ${actor.tenantId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Tabla de consulta no encontrada');
      const all = await tx.lookupRow.findMany({ where: { tableId: id, tenantId: actor.tenantId }, orderBy, select: { id: true, position: true }, take: MAX_ROWS });
      const from = all.findIndex((r) => r.id === rowId);
      if (from < 0) throw new NotFoundException('Fila no encontrada');
      const cur = all[from]!;

      let to: number;
      if (mode === 'direction') to = body.direction === 'up' ? from - 1 : from + 1;
      else if (mode === 'toTop' || body.afterRowId === null) to = 0;
      else {
        const anchor = all.findIndex((r) => r.id === body.afterRowId);
        if (anchor < 0) throw new BadRequestException('La fila de referencia no es de esta tabla');
        to = anchor === from ? from : anchor < from ? anchor + 1 : anchor;
      }
      if (to < 0 || to >= all.length || to === from) {
        return { result: { id: rowId, moved: false, index: from + 1, position: cur.position, total: all.length, revision: table.revision, changed: [] }, from, to: from, fromPosition: cur.position };
      }

      const lo = Math.min(from, to);
      const win = all.slice(lo, Math.max(from, to) + 1);
      const rest = win.filter((r) => r.id !== rowId);
      const reordered = from < to ? [...rest, cur] : [cur, ...rest];
      const slots = win.map((r) => r.position);
      const distinct = slots.every((p, i) => i === 0 || p > slots[i - 1]!);
      const before = new Map(all.map((r) => [r.id, r.position]));
      let target: { id: string; position: number }[];
      if (distinct) target = reordered.map((r, i) => ({ id: r.id, position: slots[i]! }));
      else {
        const full = [...all.slice(0, lo), ...reordered, ...all.slice(lo + win.length)];
        target = full.map((r, i) => ({ id: r.id, position: i }));
      }
      const changed = target.filter((t) => before.get(t.id) !== t.position);
      await this.writePositions(tx, id, actor.tenantId, changed.map((c) => c.id), changed.map((c) => c.position));
      const revision = await this.bump(tx, id, actor.tenantId);
      const position = changed.find((c) => c.id === rowId)?.position ?? cur.position;
      return { result: { id: rowId, moved: true, index: to + 1, position, total: all.length, revision, changed }, from, to, fromPosition: cur.position };
    });

    if (done.result.moved) {
      const r = done.result;
      await this.record(actor, 'LOOKUP_ROW_MOVED', {
        tableId: id,
        tableKey: table.key,
        rowId,
        mode: mode === 'direction' ? (body.direction as string) : mode === 'toTop' ? 'top' : 'after',
        ...(mode === 'afterRowId' ? { afterRowId: body.afterRowId } : {}),
        fromIndex: done.from + 1,
        toIndex: done.to + 1,
        fromPosition: done.fromPosition,
        toPosition: r.position,
        affected: r.changed.length,
        positions: r.changed.slice(0, MAX_AUDIT_POSITIONS),
        revision: r.revision,
      });
    }
    return done.result;
  }

  /** Importa hasta 5000 filas, todo o nada. Con `replace` borra ANTES las filas de esta tabla del tenant (y solo esas). */
  async importRows(id: string, rows: unknown, replace: boolean, actor: LookupActor) {
    const table = await this.table(id, actor.tenantId);
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('Envía al menos una fila');
    if (rows.length > MAX_ROWS) throw new BadRequestException(`Máximo ${MAX_ROWS} filas por importación`);
    const columns = toColumns(table.columns);
    const errors: string[] = [];
    const parsed: RowValues[] = [];
    rows.forEach((raw, i) => {
      const r = parseRowValues(raw, columns, `Fila ${i + 1}`);
      if (r.values) parsed.push(r.values);
      else errors.push(...r.errors);
    });
    if (errors.length) throw new BadRequestException({ message: 'La importación no es válida', errors: errors.slice(0, MAX_ERRORS) });

    const result = await this.prisma.$transaction(async (tx) => {
      let deleted = 0;
      if (replace) deleted = (await tx.lookupRow.deleteMany({ where: { tableId: id, tenantId: actor.tenantId } })).count;
      const current = replace ? 0 : await tx.lookupRow.count({ where: { tableId: id, tenantId: actor.tenantId } });
      if (current + parsed.length > MAX_ROWS) throw new BadRequestException(`La tabla admite máximo ${MAX_ROWS} filas (ya tiene ${current})`);
      const max = replace ? { _max: { position: null } } : await tx.lookupRow.aggregate({ where: { tableId: id, tenantId: actor.tenantId }, _max: { position: true } });
      const base = (max._max.position ?? -1) + 1;
      const created = await tx.lookupRow.createMany({
        data: parsed.map((values, i) => ({ tenantId: actor.tenantId, tableId: id, values: values as unknown as Prisma.InputJsonValue, position: base + i })),
      });
      return { imported: created.count, deleted, revision: await this.bump(tx, id, actor.tenantId) };
    });
    await this.record(actor, 'LOOKUP_ROWS_IMPORTED', { tableId: id, tableKey: table.key, count: result.imported, replace, deleted: result.deleted, revision: result.revision });
    return result;
  }

  /** Sube la revisión de la tabla (acotada al tenant) y la devuelve. */
  private async bump(tx: Prisma.TransactionClient, id: string, tenantId: string): Promise<number> {
    const res = await tx.lookupTable.updateMany({ where: { id, tenantId }, data: { revision: { increment: 1 } } });
    if (res.count === 0) throw new NotFoundException('Tabla de consulta no encontrada');
    const fresh = await tx.lookupTable.findFirst({ where: { id, tenantId }, select: { revision: true } });
    return fresh?.revision ?? 0;
  }

  // ───────────────────────────── prueba (dry-run) ─────────────────────────────

  /** Evalúa una consulta contra la tabla SIN efectos: qué filas coinciden y por qué cada una coincide o falla. */
  async test(id: string, rawQuery: unknown, rawInputs: unknown, tenantId: string) {
    const table = await this.table(id, tenantId);
    const columns = toColumns(table.columns);
    // Cualquier variable es válida en una prueba: si no viene en `inputs`, la solicitud «no trae valor».
    const anyVar = { has: () => true } as unknown as ReadonlySet<string>;
    const shape = validateLookupQuery(rawQuery, 'Consulta', anyVar);
    if (shape.length) throw new BadRequestException({ message: 'La consulta no es válida', errors: shape });
    const query = rawQuery as LookupQuery;
    if (query.table !== table.key) throw new BadRequestException(`La consulta apunta a la tabla «${query.table}», no a «${table.key}»`);
    const inputs = parseInputs(rawInputs);
    if (!inputs.inputs) throw new BadRequestException({ message: 'Los valores de prueba no son válidos', errors: inputs.errors });
    const against = checkQueryAgainstColumns(query, columns, 'Consulta');
    if (against.length) throw new BadRequestException({ message: 'La consulta no es válida', errors: against });

    const rows = await this.prisma.lookupRow.findMany({
      where: { tableId: id, tenantId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: MAX_ROWS,
    });
    const out = dryRun(
      { key: table.key, revision: table.revision, columns, rows: rows.map((r) => ({ id: r.id, position: r.position, active: r.active, values: toValues(r.values) })) },
      query,
      inputs.inputs,
    );
    // `order` = lugar de la fila (desde 1) en el orden de evaluación de TODA la tabla: la pantalla no necesita cargar las filas para numerarlas.
    const order = new Map(rows.map((r, i) => [r.id, i + 1]));
    return {
      ...out,
      matches: out.matches.map((m) => ({ ...m, order: order.get(m.rowId) ?? 0 })),
      first: out.first ? { ...out.first, order: order.get(out.first.rowId) ?? 0 } : null,
      explain: out.explain.map((e) => ({ ...e, order: order.get(e.rowId) ?? 0 })),
    };
  }
}
