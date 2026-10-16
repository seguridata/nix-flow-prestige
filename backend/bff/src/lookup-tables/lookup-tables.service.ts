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

const MAX_ERRORS = 50;
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

  /** Filas por cursor (orden de evaluación: position, id). Con `q` se filtra en memoria sobre las filas de la tabla (≤ 5000). */
  async listRows(id: string, filter: RowsFilter, tenantId: string): Promise<{ items: RowView[]; nextCursor: string | null }> {
    await this.table(id, tenantId);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(filter.limit ?? DEFAULT_PAGE_LIMIT) || DEFAULT_PAGE_LIMIT));
    const where = { tableId: id, tenantId };
    const orderBy = [{ position: 'asc' as const }, { id: 'asc' as const }];
    const q = filter.q?.trim();

    if (!q) {
      const rows = await this.prisma.lookupRow.findMany({
        where,
        orderBy,
        take: limit + 1,
        ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      });
      const more = rows.length > limit;
      const items = (more ? rows.slice(0, limit) : rows).map(toRow);
      return { items, nextCursor: more ? items[items.length - 1]!.id : null };
    }

    const needle = normText(q);
    const all = await this.prisma.lookupRow.findMany({ where, orderBy, take: MAX_ROWS });
    const hits = all.filter((r) => Object.values(toValues(r.values)).some((v) => normText(v).includes(needle)));
    const start = filter.cursor ? hits.findIndex((r) => r.id === filter.cursor) + 1 : 0;
    const page = hits.slice(start, start + limit + 1);
    const more = page.length > limit;
    const items = (more ? page.slice(0, limit) : page).map(toRow);
    return { items, nextCursor: more ? items[items.length - 1]!.id : null };
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
      await tx.$executeRaw`UPDATE "LookupRow" AS r SET "position" = u."pos", "updatedAt" = now() FROM unnest(${order}::text[], ${positions}::int[]) AS u("id", "pos") WHERE r."id" = u."id" AND r."tableId" = ${id} AND r."tenantId" = ${actor.tenantId}`;
      return this.bump(tx, id, actor.tenantId);
    });
    await this.record(actor, 'LOOKUP_ROWS_REORDERED', { tableId: id, tableKey: table.key, count: order.length, revision });
    return { reordered: order.length, revision };
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
    return dryRun(
      { key: table.key, revision: table.revision, columns, rows: rows.map((r) => ({ id: r.id, position: r.position, active: r.active, values: toValues(r.values) })) },
      query,
      inputs.inputs,
    );
  }
}
