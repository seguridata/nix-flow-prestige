import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ExpenseResponsible, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditChainService } from '../collaboration/audit-chain.service';
import { finishPage, pageArgs, prismaPage, type PageQueryDto } from '../common/pagination';
import {
  ANY_AREA,
  MAX_IMPORT_ROWS,
  assertRow,
  parseRow,
  pickResponsible,
  type Candidate,
  type ExpenseRow,
  type ExpenseStage,
  type Match,
  type RowInput,
} from './expense-responsibles.resolver';

export interface ExpenseActor {
  /** SLUG del tenant (el que deja el guard), nunca el uuid de la membresía. */
  tenantId: string;
  actorId: string;
  name?: string;
}

export interface ExpenseListFilter extends PageQueryDto {
  stage?: ExpenseStage;
  area?: string;
  active?: string;
}

/** Tope de filas candidatas que se cargan para resolver (una matriz razonable trae unas decenas). */
const CANDIDATE_CAP = 500;

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

export const toRow = (r: ExpenseResponsible): ExpenseRow => ({
  id: r.id,
  area: r.area,
  expenseType: r.expenseType,
  concept: r.concept,
  stage: r.stage as ExpenseStage,
  minAmount: num(r.minAmount),
  maxAmount: num(r.maxAmount),
  signerId: r.signerId,
  name: r.name,
  email: r.email,
  active: r.active,
});

@Injectable()
export class ExpenseResponsiblesService {
  private readonly log = new Logger(ExpenseResponsiblesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditChainService,
  ) {}

  /** Auditoría sin datos personales: ids y etapa/área, nunca nombre ni correo. */
  private async record(actor: ExpenseActor, action: string, payload: Record<string, unknown>) {
    try {
      await this.audit.append({ tenantId: actor.tenantId, actorId: actor.actorId, actorName: actor.name, action, payload });
    } catch (e) {
      this.log.error(`No se pudo registrar ${action} en la auditoría: ${(e as Error).message}`);
    }
  }

  async list(tenantId: string, filter: ExpenseListFilter = {}) {
    const args = pageArgs(filter);
    const where: Prisma.ExpenseResponsibleWhereInput = {
      tenantId,
      ...(filter.stage ? { stage: filter.stage } : {}),
      ...(filter.area ? { area: { equals: filter.area.trim(), mode: 'insensitive' } } : {}),
      ...(filter.active === 'true' ? { active: true } : filter.active === 'false' ? { active: false } : {}),
    };
    const rows = await this.prisma.expenseResponsible.findMany({
      where,
      orderBy: [{ area: 'asc' }, { stage: 'asc' }, { id: 'asc' }],
      ...prismaPage(args),
    });
    const page = finishPage(rows, args);
    return Array.isArray(page) ? page.map(toRow) : { items: page.items.map(toRow), nextCursor: page.nextCursor };
  }

  async create(raw: unknown, actor: ExpenseActor): Promise<ExpenseRow> {
    const data = assertRow(raw);
    const created = await this.prisma.expenseResponsible.create({ data: { ...data, tenantId: actor.tenantId } });
    await this.record(actor, 'EXPENSE_RESPONSIBLE_CREATED', { id: created.id, stage: data.stage, area: data.area, expenseType: data.expenseType, concept: data.concept });
    return toRow(created);
  }

  /** Edición parcial: lo que no venga conserva su valor. Siempre acotada al tenant (otro tenant → 404). */
  async update(id: string, raw: unknown, actor: ExpenseActor): Promise<ExpenseRow> {
    const current = await this.prisma.expenseResponsible.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!current) throw new NotFoundException('Responsable no encontrado');
    const base = toRow(current);
    const patch = Object.fromEntries(Object.entries((raw ?? {}) as Record<string, unknown>).filter(([, v]) => v !== undefined));
    const data = assertRow({ ...base, ...patch });
    // updateMany con tenantId: aunque el findFirst se saltara, la escritura no cruza de tenant.
    const res = await this.prisma.expenseResponsible.updateMany({ where: { id, tenantId: actor.tenantId }, data });
    if (res.count === 0) throw new NotFoundException('Responsable no encontrado');
    await this.record(actor, 'EXPENSE_RESPONSIBLE_UPDATED', { id, stage: data.stage, area: data.area, expenseType: data.expenseType, concept: data.concept, active: data.active });
    return { ...base, ...data, id };
  }

  async remove(id: string, actor: ExpenseActor): Promise<void> {
    const res = await this.prisma.expenseResponsible.deleteMany({ where: { id, tenantId: actor.tenantId } });
    if (res.count === 0) throw new NotFoundException('Responsable no encontrado');
    await this.record(actor, 'EXPENSE_RESPONSIBLE_DELETED', { id });
  }

  /** Importa hasta 500 filas; con `replace` borra ANTES las del tenant (y solo las del tenant). Todo o nada. */
  async importRows(rows: unknown, replace: boolean, actor: ExpenseActor) {
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('Envía al menos una fila');
    if (rows.length > MAX_IMPORT_ROWS) throw new BadRequestException(`Máximo ${MAX_IMPORT_ROWS} filas por importación`);
    const errors: string[] = [];
    const parsed: RowInput[] = [];
    rows.forEach((raw, i) => {
      const { row, errors: e } = parseRow(raw, `Fila ${i + 1}`);
      if (row) parsed.push(row);
      errors.push(...e);
    });
    if (errors.length) throw new BadRequestException({ message: 'La importación no es válida', errors: errors.slice(0, 50) });

    const tenantId = actor.tenantId;
    const [deleted, created] = await this.prisma.$transaction([
      this.prisma.expenseResponsible.deleteMany({ where: replace ? { tenantId } : { tenantId, id: { in: [] } } }),
      this.prisma.expenseResponsible.createMany({ data: parsed.map((r) => ({ ...r, tenantId })) }),
    ]);
    await this.record(actor, 'EXPENSE_RESPONSIBLES_IMPORTED', { count: created.count, replace, deleted: deleted.count });
    return { imported: created.count, deleted: deleted.count };
  }

  /** Filas activas del tenant que pueden aplicar a (stage, área, tipo): una sola consulta acotada. */
  async candidates(
    tenantId: string,
    stages: ExpenseStage[],
    q: { area?: string | null; expenseType?: string | null; concept?: string | null } = {},
  ): Promise<Candidate[]> {
    if (!stages.length) return [];
    const a = (q.area ?? '').trim();
    const t = (q.expenseType ?? '').trim();
    const c = (q.concept ?? '').trim();
    const rows = await this.prisma.expenseResponsible.findMany({
      where: {
        tenantId,
        active: true,
        stage: { in: stages },
        AND: [
          { OR: [{ area: ANY_AREA }, ...(a ? [{ area: { equals: a, mode: 'insensitive' as const } }] : [])] },
          { OR: [{ expenseType: null }, ...(t ? [{ expenseType: { equals: t, mode: 'insensitive' as const } }] : [])] },
          { OR: [{ concept: null }, ...(c ? [{ concept: { equals: c, mode: 'insensitive' as const } }] : [])] },
        ],
      },
      take: CANDIDATE_CAP,
    });
    return rows.map(toRow);
  }

  async resolve(
    tenantId: string,
    q: { stage: ExpenseStage; area?: string | null; expenseType?: string | null; concept?: string | null; amount?: number | null },
  ): Promise<{ match: Match | null }> {
    const rows = await this.candidates(tenantId, [q.stage], q);
    return { match: pickResponsible(rows, q) };
  }
}
