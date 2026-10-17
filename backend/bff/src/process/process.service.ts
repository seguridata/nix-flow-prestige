import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma, type ProcessDefinition } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { finishPage, pageArgs, prismaPage, type PageQueryDto } from '../common/pagination';
import { RedisService } from '../redis/redis.service';
import { evaluateDmn } from './dmn-engine';
import { flowTableKeys, flowToBpmn, validateFlow } from '../flow/flow';
import { bpmnToFlow } from '../flow/bpmn-to-flow';
import { checkFlowAgainstTables } from '../lookup-tables/lookup-validation';
import type { LookupColumn } from '../lookup-tables/lookup-engine';
import type { Flow } from '../flow/flow.types';
import { FlowResolverService } from '../lookup-tables/flow-resolver.service';
import { parseInputs } from '../lookup-tables/lookup-validation';
import {
  CONTRATO_BPMN,
  DEFAULT_DECISION_RULES,
  ONBOARDING_BPMN,
  SLA_DMN,
} from './defaults';
import {
  ADQUISICIONES_BPMN,
  PROVEEDORES_ESTRATEGICOS_BPMN,
  RENOVACION_LICENCIAS_BPMN,
} from './adquisiciones';
import { ADQUISICIONES_FLOW, PROVEEDORES_ESTRATEGICOS_FLOW, RENOVACION_LICENCIAS_FLOW } from './adquisiciones.flows';

/** JSON con las claves ordenadas: dos flujos iguales dan el mismo texto sin importar el orden de las claves. */
function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(sort(value));
}

/** Dueño de las definiciones sembradas por el sistema: las ven todos los tenants y ninguno puede modificarlas. */
export const PLATFORM_TENANT = 'platform';

const SEEDS: Array<{
  key: string;
  name: string;
  description: string;
  bpmnXml: string;
  dmnXml: string;
  decisionRules: Prisma.InputJsonValue;
  /** Flujo ejecutable por defecto; si falta, la definición solo trae el diagrama. */
  flow?: Flow;
}> = [
  {
    key: 'adquisiciones-gastos',
    name: 'Proceso de Adquisiciones (Gastos)',
    description: 'SD-ADMINFINANZAS-03 v08: solicitud, cotizaciones, orden de compra, compra, recepción, factura y pago. El flujo se bifurca por tipo de gasto.',
    bpmnXml: ADQUISICIONES_BPMN,
    dmnXml: SLA_DMN,
    decisionRules: DEFAULT_DECISION_RULES as Prisma.InputJsonValue,
    flow: ADQUISICIONES_FLOW,
  },
  {
    key: 'renovacion-licenciamiento',
    name: 'Subproceso: Renovación de licenciamiento',
    description: 'Monitoreo de vencimientos, solicitud con 60 días y validación contra presupuesto.',
    bpmnXml: RENOVACION_LICENCIAS_BPMN,
    dmnXml: SLA_DMN,
    decisionRules: DEFAULT_DECISION_RULES as Prisma.InputJsonValue,
    flow: RENOVACION_LICENCIAS_FLOW,
  },
  {
    key: 'proveedores-estrategicos',
    name: 'Subproceso: Gestión de proveedores estratégicos',
    description: 'Revisión anual de desempeño, negociación anual y actualización de la lista aprobada.',
    bpmnXml: PROVEEDORES_ESTRATEGICOS_BPMN,
    dmnXml: SLA_DMN,
    decisionRules: DEFAULT_DECISION_RULES as Prisma.InputJsonValue,
    flow: PROVEEDORES_ESTRATEGICOS_FLOW,
  },
  {
    key: 'contrato-dos-partes',
    name: 'Contrato corporativo de dos partes',
    description: 'Revisión legal, firma secuencial de dos partes, validación y evidencia.',
    bpmnXml: CONTRATO_BPMN,
    dmnXml: SLA_DMN,
    decisionRules: DEFAULT_DECISION_RULES,
  },
  {
    key: 'onboarding-identidad',
    name: 'Onboarding e identidad digital',
    description: 'Alta M16: datos, INE, prueba de vida, face-match y habilitación de firma.',
    bpmnXml: ONBOARDING_BPMN,
    dmnXml: SLA_DMN,
    decisionRules: DEFAULT_DECISION_RULES,
  },
];

/**
 * Definiciones BPMN/DMN. Cada una pertenece a un tenant o a la plataforma (`PLATFORM_TENANT`):
 *  - un tenant ve las suyas y las de la plataforma; una suya con la misma clave tapa a la de la plataforma;
 *  - solo puede modificar las suyas. Editar una de la plataforma crea una copia propia (versión 1);
 *  - todo lo cacheado lleva el tenant en la clave.
 */
@Injectable()
export class ProcessService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly resolver: FlowResolverService,
  ) {}

  async onModuleInit() {
    await this.ensureSeeds();
  }

  private async invalidateProcessCache(tenantId: string, key?: string) {
    await this.redis.del(`process:list:${tenantId}`, ...(key ? [`process:latest:${tenantId}:${key}`] : []));
  }

  async ensureSeeds() {
    for (const seed of SEEDS) {
      const existing = await this.prisma.processDefinition.findFirst({
        where: { tenantId: PLATFORM_TENANT, key: seed.key },
        orderBy: { version: 'desc' },
      });
      // Sin definición, se crea. Con una que aún no trae flujo, o cuyo flujo difiere del sembrado, y una semilla que sí
      // lo trae, se agrega una versión nueva con el flujo (las de la plataforma no se editan; la anterior queda intacta).
      // Idempotente: con el mismo flujo (JSON estable) no se crea nada.
      const needsFlow =
        !!existing && !!seed.flow && (!existing.flow || stableJson(existing.flow) !== stableJson(seed.flow));
      if (!existing || needsFlow) {
        const { flow, ...rest } = seed;
        try {
          await this.prisma.processDefinition.create({
            data: {
              ...rest,
              tenantId: PLATFORM_TENANT,
              version: existing ? existing.version + 1 : 1,
              ...(flow ? { flow: flow as unknown as Prisma.InputJsonValue } : {}),
            },
          });
        } catch (error) {
          // Arranques paralelos (varias réplicas): @@unique([tenantId, key, version]) → ya lo creó otra.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        }
      }
    }
  }

  /** Lo que un tenant puede leer: lo suyo y lo de la plataforma. */
  private readable(tenantId: string) {
    return { OR: [{ tenantId }, { tenantId: PLATFORM_TENANT }] };
  }

  private async visibleWhere(tenantId: string) {
    const hidden = await this.prisma.processCatalogPreference.findMany({
      where: { tenantId, archivedAt: { not: null } }, select: { key: true },
    });
    return { ...this.readable(tenantId), ...(hidden.length ? { key: { notIn: hidden.map((p) => p.key) } } : {}) };
  }

  async list(tenantId: string, page?: PageQueryDto) {
    const args = pageArgs(page);
    // Orden de dominio estable (key asc, version desc, id desc).
    const orderBy = [{ key: 'asc' as const }, { version: 'desc' as const }, { id: 'desc' as const }];
    const where = await this.visibleWhere(tenantId);
    // Paginado: sin caché (la clave dependería del cursor). Sin limit/cursor: array con caché por tenant.
    if (args.paged) {
      const rows = await this.prisma.processDefinition.findMany({ where, orderBy, ...prismaPage(args) });
      return finishPage(rows, args);
    }
    // D10 — lectura caliente: el diseñador la pide seguido y cambia poco.
    return this.redis.withCache(`process:list:${tenantId}`, 60, () =>
      this.prisma.processDefinition.findMany({ where, orderBy, ...prismaPage(args) }),
    );
  }

  /** Solo las versiones publicadas (lo que ven los remitentes al crear un sobre). */
  async listPublished(tenantId: string) {
    const where = await this.visibleWhere(tenantId);
    const rows = await this.prisma.processDefinition.findMany({
      where: { ...where, published: true },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
    // Una copia propia tapa a la plataforma incluso si aún es un borrador.
    const own = await this.prisma.processDefinition.findMany({ where: { tenantId }, select: { key: true } });
    const ownKeys = new Set(own.map((row) => row.key));
    const unique = new Map<string, ProcessDefinition>();
    for (const row of rows) {
      if (row.tenantId === PLATFORM_TENANT && ownKeys.has(row.key)) continue;
      if (!unique.has(row.key)) unique.set(row.key, row);
    }
    return [...unique.values()];
  }

  async catalog(tenantId: string) {
    const rows = await this.prisma.processDefinition.findMany({
      where: await this.visibleWhere(tenantId), orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
    const groups = new Map<string, ProcessDefinition[]>();
    for (const row of rows) groups.set(row.key, [...(groups.get(row.key) ?? []), row]);
    return [...groups.values()].map((group) => {
      const own = group.filter((row) => row.tenantId === tenantId);
      const versions = (own.length ? own : group).sort((a, b) => b.version - a.version);
      return {
        ...versions[0], versionCount: versions.length,
        publishedVersion: versions.find((row) => row.published)?.version ?? null,
        source: own.length ? 'tenant' as const : 'platform' as const,
      };
    });
  }

  async versions(key: string, tenantId: string) {
    const latest = await this.getLatest(key, tenantId);
    return this.prisma.processDefinition.findMany({
      where: { tenantId: latest.tenantId, key }, orderBy: { version: 'desc' },
    });
  }

  async getVersion(key: string, version: number, tenantId: string) {
    // El dueño efectivo se determina igual que en catálogo; nunca se cruzan versiones
    // de plataforma con las de una copia del tenant que usa la misma clave.
    const latest = await this.getLatest(key, tenantId);
    const row = await this.prisma.processDefinition.findFirst({ where: { tenantId: latest.tenantId, key, version } });
    if (!row) throw new NotFoundException(`Versión ${version} de ${key} no encontrada`);
    return row;
  }

  async archive(key: string, tenantId: string) {
    await this.getLatest(key, tenantId);
    await this.prisma.$transaction([
      this.prisma.processCatalogPreference.upsert({
        where: { tenantId_key: { tenantId, key } }, create: { tenantId, key, archivedAt: new Date() },
        update: { archivedAt: new Date() },
      }),
      this.prisma.processDefinition.updateMany({ where: { tenantId, key }, data: { published: false, publishedAt: null } }),
    ]);
    await this.invalidateProcessCache(tenantId, key);
    return { key, archived: true as const };
  }

  async unarchive(key: string, tenantId: string) {
    await this.getLatest(key, tenantId);
    await this.prisma.processCatalogPreference.upsert({
      where: { tenantId_key: { tenantId, key } }, create: { tenantId, key }, update: { archivedAt: null },
    });
    await this.invalidateProcessCache(tenantId, key);
    return { key, archived: false as const };
  }

  async restore(key: string, version: number, tenantId: string) {
    const source = await this.getVersion(key, version, tenantId);
    const latest = await this.findLatest(key, tenantId);
    const created = await this.prisma.processDefinition.create({
      data: {
        tenantId, key, version: latest?.tenantId === tenantId ? latest.version + 1 : 1,
        name: source.name, description: source.description, bpmnXml: source.bpmnXml, dmnXml: source.dmnXml,
        flow: source.flow === null ? Prisma.JsonNull : source.flow,
        decisionRules: source.decisionRules === null ? Prisma.JsonNull : source.decisionRules,
        published: false, publishedAt: null,
      },
    });
    await this.unarchive(key, tenantId);
    return created;
  }

  async preflight(key: string, tenantId: string, body: { version?: number; flow?: unknown } = {}) {
    const definition = body.version !== undefined
      ? await this.getVersion(key, body.version, tenantId) : await this.getLatest(key, tenantId);
    const errors: string[] = [];
    const warnings: string[] = [];
    const checks: Array<{ key: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }> = [];
    let raw: unknown = body.flow ?? definition.flow;
    if (!raw) {
      const converted = bpmnToFlow(definition.bpmnXml);
      raw = converted.flow;
      errors.push(...converted.errors);
      warnings.push(...converted.warnings);
      if (raw) warnings.push('El diagrama puede convertirse: guarda el flujo ejecutable antes de publicar.');
      else errors.push('El proceso todavía no tiene un flujo ejecutable.');
    }
    const validation = raw ? validateFlow(raw) : [];
    errors.push(...validation);
    checks.push({ key: 'flow', label: 'Estructura ejecutable', status: !raw || validation.length ? 'fail' : 'pass',
      detail: !raw ? 'Convierte el diagrama o crea los pasos en el constructor.' : validation.length ? validation.join('; ') : 'Pasos, variables y condiciones válidos.' });
    let flow: Flow | undefined;
    let keys: string[] = [];
    if (raw && !validation.length) {
      flow = raw as Flow;
      keys = flowTableKeys(flow);
      const tables = keys.length ? await this.prisma.lookupTable.findMany({
        where: { tenantId, key: { in: keys }, active: true },
        select: { key: true, columns: true, _count: { select: { rows: { where: { tenantId, active: true } } } } },
      }) : [];
      const tableErrors = checkFlowAgainstTables(flow, new Map(tables.map((table) => [table.key, table.columns as unknown as LookupColumn[]])));
      errors.push(...tableErrors);
      for (const table of tables) if (table._count.rows === 0) {
        const required = flow.derived?.some((variable) => variable.query.table === table.key && variable.onMiss === 'fail');
        const message = `La tabla «${table.key}» no tiene filas activas${required ? ' y una variable derivada exige coincidencia.' : '; se usará la pregunta de respaldo.'}`;
        (required ? errors : warnings).push(message);
      }
      checks.push({ key: 'lookups', label: 'Reglas y responsables', status: tableErrors.length ? 'fail' : 'pass',
        detail: tableErrors.length ? tableErrors.join('; ') : keys.length ? `${keys.length} tablas activas con columnas compatibles.` : 'No requiere tablas de consulta.' });
      const asks = flow.steps.filter((step) => step.who.type === 'ask').length;
      if (asks) warnings.push(`${asks} pasos solicitan seleccionar a una persona al iniciar la solicitud.`);
      const conditional = flow.steps.filter((step) => step.when?.length).length;
      if (conditional === flow.steps.length) warnings.push('Todos los pasos tienen condiciones: comprueba que cada caso tenga al menos un participante.');
      checks.push({ key: 'participants', label: 'Participantes', status: asks ? 'warn' : 'pass',
        detail: `${flow.steps.length} pasos; ${asks} participantes por seleccionar al iniciar.` });
    }
    const archived = await this.prisma.processCatalogPreference.findFirst({ where: { tenantId, key, archivedAt: { not: null } } });
    if (archived) errors.push('El proceso está archivado; restáuralo al catálogo antes de publicarlo.');
    if (!definition.flow && !body.flow && raw) errors.push('Guarda el flujo convertido antes de publicarlo.');
    checks.push({ key: 'catalog', label: 'Disponible en catálogo', status: archived ? 'fail' : 'pass', detail: archived ? 'Archivado para este espacio.' : 'Visible en este espacio.' });
    return {
      valid: errors.length === 0, ready: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], checks,
      summary: { steps: flow?.steps.length ?? 0, variables: flow?.variables.length ?? 0, lookups: keys.length },
      definition: { key: definition.key, version: definition.version, name: definition.name },
    };
  }

  async previewFlow(key: string, tenantId: string, actorId: string, body: { version?: number; flow?: unknown; values?: unknown }) {
    const definition = body.version !== undefined
      ? await this.getVersion(key, body.version, tenantId) : await this.getLatest(key, tenantId);
    const flow = this.assertFlow(body.flow ?? definition.flow);
    const inputs = parseInputs(body.values);
    if (inputs.errors.length) throw new BadRequestException({ message: 'Datos de recorrido inválidos', errors: inputs.errors });
    const resolution = await this.resolver.resolve(flow, inputs.inputs ?? {}, tenantId, { solicitante: actorId });
    return {
      values: resolution.values, order: flow.order, slaHours: flow.slaHours,
      steps: resolution.resolved.map(({ step, active }) => {
        const who = step.who;
        const participant = !active ? null : who.type === 'initiator' ? { signerId: actorId, name: null, email: null }
          : who.type === 'fixed' ? { signerId: who.signerId, name: who.name ?? null, email: who.email ?? null }
            : resolution.picks.get(step.id) ?? null;
        const awaiting = resolution.awaiting.get(step.id) ?? [];
        return { id: step.id, label: step.label, role: step.role, active, participant, awaiting,
          needsSelection: active && !participant && awaiting.length === 0 };
      }),
      lookups: resolution.steps, derived: resolution.derived,
    };
  }

  async exportPackage(key: string, tenantId: string) {
    const definition = await this.getLatest(key, tenantId);
    const flow = this.assertFlow(definition.flow);
    // Portabilidad de la configuración; nunca incluye filas de directorio, tokens,
    // documentos ni credenciales. Los participantes fijos son parte del flujo.
    const payload = { name: definition.name, description: definition.description, flow };
    return { format: 'prestige-process' as const, version: 1 as const, payload,
      sha256: createHash('sha256').update(stableJson(payload)).digest('hex') };
  }

  async importPackage(tenantId: string, raw: { format: string; version: number; payload: Record<string, unknown>; sha256: string }) {
    if (raw.format !== 'prestige-process' || raw.version !== 1) throw new BadRequestException('Formato de paquete no compatible.');
    const { payload } = raw;
    if (!payload || typeof payload.name !== 'string' || payload.name.trim().length < 3 || payload.name.length > 120 ||
      (payload.description !== null && payload.description !== undefined && (typeof payload.description !== 'string' || payload.description.length > 500)) ||
      Object.keys(payload).some((key) => !['name', 'description', 'flow'].includes(key))) {
      throw new BadRequestException('El paquete debe contener nombre, descripción y flujo.');
    }
    const digest = createHash('sha256').update(stableJson(payload)).digest('hex');
    if (!/^[a-f0-9]{64}$/i.test(raw.sha256) || !timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(raw.sha256, 'hex'))) {
      throw new BadRequestException('La integridad del paquete no coincide con su SHA-256.');
    }
    // createFromFlow aplica validación estructural y genera BPMN nuevo: no importa XML arbitrario.
    return this.createFromFlow(tenantId, { name: payload.name, description: payload.description as string | undefined ?? undefined, flow: payload.flow });
  }

  async impact(key: string, tenantId: string) {
    await this.getLatest(key, tenantId);
    const [runs, templates] = await Promise.all([
      this.prisma.workflowRun.groupBy({ by: ['status'], where: { tenantId, processKey: key }, _count: { _all: true } }),
      this.prisma.documentTemplate.groupBy({ by: ['flowVersion'], where: { tenantId, flowKey: key }, _count: { _all: true } }),
    ]);
    const byStatus = runs.map((row) => ({ status: row.status, count: row._count._all }));
    return {
      key, workflows: { total: byStatus.reduce((sum, row) => sum + row.count, 0),
        active: byStatus.filter((row) => ['ACTIVO', 'LOCAL', 'PENDIENTE', 'EN_PROCESO', 'RUNNING', 'CREATED', 'STARTING', 'STARTED'].includes(row.status.toUpperCase())).reduce((sum, row) => sum + row.count, 0), byStatus },
      templates: { total: templates.reduce((sum, row) => sum + row._count._all, 0),
        byVersion: templates.map((row) => ({ version: row.flowVersion, count: row._count._all })) },
      versionAttribution: 'not-recorded' as const,
    };
  }

  private static slugify(name: string): string {
    const slug = name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return slug || 'flujo';
  }

  private assertFlow(flow: unknown): Flow {
    const errors = validateFlow(flow);
    if (errors.length) throw new BadRequestException({ message: 'El flujo no es válido', errors });
    return flow as Flow;
  }

  /** Última versión de la clave que el tenant ve: la suya si existe y, si no, la de la plataforma. */
  private async findLatest(key: string, tenantId: string): Promise<ProcessDefinition | null> {
    const own = await this.prisma.processDefinition.findFirst({ where: { tenantId, key }, orderBy: { version: 'desc' } });
    if (own) return own;
    return this.prisma.processDefinition.findFirst({ where: { tenantId: PLATFORM_TENANT, key }, orderBy: { version: 'desc' } });
  }

  /** Una versión concreta, solo si es del tenant. Las de la plataforma responden 403 y las ajenas, 404. */
  private async ownVersion(key: string, version: number, tenantId: string): Promise<ProcessDefinition> {
    const own = await this.prisma.processDefinition.findFirst({ where: { tenantId, key, version } });
    if (own) return own;
    const platform = await this.prisma.processDefinition.findFirst({ where: { tenantId: PLATFORM_TENANT, key, version } });
    if (platform) throw new ForbiddenException('Las definiciones de la plataforma no se modifican; edítala para crear tu propia copia.');
    throw new NotFoundException(`Versión ${version} de ${key} no encontrada`);
  }

  /** Crea un flujo nuevo del admin como borrador (versión 1, sin publicar). */
  async createFromFlow(tenantId: string, body: { name: string; description?: string; flow: unknown }) {
    const flow = this.assertFlow(body.flow);
    const base = ProcessService.slugify(body.name);
    // La clave no puede repetir una propia ni una de la plataforma (taparía a la de la plataforma sin querer).
    let key = base;
    for (
      let n = 2;
      await this.prisma.processDefinition.findFirst({ where: { ...this.readable(tenantId), key }, select: { id: true } });
      n++
    ) {
      key = `${base}-${n}`;
    }
    const created = await this.prisma.processDefinition.create({
      data: {
        tenantId,
        key,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        version: 1,
        bpmnXml: flowToBpmn(flow, { key, name: body.name.trim() }),
        flow: flow as unknown as Prisma.InputJsonValue,
        published: false,
      },
    });
    await this.invalidateProcessCache(tenantId, key);
    return created;
  }

  /** Nueva versión borrador del flujo (el BPMN se regenera desde el flujo). Sobre una de la plataforma crea la copia propia. */
  async saveFlow(key: string, tenantId: string, body: { flow: unknown; name?: string; description?: string }) {
    const flow = this.assertFlow(body.flow);
    const latest = await this.findLatest(key, tenantId);
    if (!latest) throw new NotFoundException(`Proceso ${key} no encontrado`);
    const own = latest.tenantId === tenantId;
    const name = body.name?.trim() || latest.name;
    const created = await this.prisma.processDefinition.create({
      data: {
        tenantId,
        key,
        name,
        description: body.description !== undefined ? body.description.trim() || null : latest.description,
        version: own ? latest.version + 1 : 1,
        bpmnXml: flowToBpmn(flow, { key, name }),
        dmnXml: latest.dmnXml,
        decisionRules: latest.decisionRules === null ? undefined : latest.decisionRules,
        flow: flow as unknown as Prisma.InputJsonValue,
        published: false,
      },
    });
    await this.invalidateProcessCache(tenantId, key);
    return created;
  }

  /** Publica una versión propia; las demás de la misma clave del tenant quedan sin publicar. */
  async publish(key: string, version: number, tenantId: string) {
    const target = await this.ownVersion(key, version, tenantId);
    if (target.flow) this.assertFlow(target.flow);
    const preflight = await this.preflight(key, tenantId, { version });
    if (!preflight.ready) throw new BadRequestException({ message: 'Resuelve los problemas antes de publicar', errors: preflight.errors });
    const [, published] = await this.prisma.$transaction([
      this.prisma.processDefinition.updateMany({ where: { tenantId, key, version: { not: version } }, data: { published: false } }),
      this.prisma.processDefinition.update({ where: { id: target.id, tenantId }, data: { published: true, publishedAt: new Date() } }),
    ]);
    await this.invalidateProcessCache(tenantId, key);
    return published;
  }

  async unpublish(key: string, version: number, tenantId: string) {
    const target = await this.ownVersion(key, version, tenantId);
    const updated = await this.prisma.processDefinition.update({
      where: { id: target.id, tenantId },
      data: { published: false, publishedAt: null },
    });
    await this.invalidateProcessCache(tenantId, key);
    return updated;
  }

  async getLatest(key: string, tenantId: string) {
    const found = await this.redis.withCache(`process:latest:${tenantId}:${key}`, 60, () => this.findLatest(key, tenantId));
    if (!found) throw new NotFoundException(`Proceso ${key} no encontrado`);
    return found;
  }

  /** Guarda el XML editado en el modelador como versión nueva del tenant. Sobre una de la plataforma crea la copia propia. */
  async saveXml(key: string, tenantId: string, body: { bpmnXml?: string; dmnXml?: string; name?: string }) {
    const latest = await this.findLatest(key, tenantId);
    if (!latest) throw new NotFoundException(`Proceso ${key} no encontrado`);
    const own = latest.tenantId === tenantId;
    const created = await this.prisma.processDefinition.create({
      data: {
        tenantId,
        key,
        name: body.name ?? latest.name,
        description: latest.description,
        version: own ? latest.version + 1 : 1,
        bpmnXml: body.bpmnXml ?? latest.bpmnXml,
        dmnXml: body.dmnXml ?? latest.dmnXml,
        decisionRules: latest.decisionRules === null ? undefined : latest.decisionRules,
        published: false,
      },
    });
    await this.invalidateProcessCache(tenantId, key);
    return created;
  }

  private readonly log = new Logger(ProcessService.name);

  /**
   * Decide SLA / orden / método a partir de un contexto. Evalúa DE VERDAD el
   * `dmnXml` del proceso con el motor DMN (FEEL); si el proceso no tiene DMN,
   * evalúa el `decisionRules` guardado; como último recurso, la constante.
   */
  async decide(context: Record<string, unknown>, processKey: string, tenantId: string) {
    const tipo = String(context.tipo ?? 'contrato').toLowerCase();
    const ctx = { ...context, tipo };

    const def = await this.findLatest(processKey, tenantId).catch(() => null);

    // 1. Motor DMN sobre el dmnXml del proceso.
    if (def?.dmnXml) {
      try {
        const result = evaluateDmn(def.dmnXml, ctx);
        const out = (result?.outputs ?? {}) as Record<string, unknown>;
        if (out.slaHours != null || out.order != null || out.method != null) {
          return {
            tipo,
            slaHours: Number(out.slaHours ?? 48),
            order: String(out.order ?? 'SECUENCIAL'),
            method: out.method != null ? String(out.method) : undefined,
            hitPolicy: result?.hitPolicy ?? 'UNIQUE',
            source: 'dmn' as const,
            matchedRules: result?.matchedRules ?? [],
          };
        }
      } catch (error) {
        this.log.warn(`DMN no evaluó (${(error as Error).message}); uso decisionRules`);
      }
    }

    // 2. decisionRules guardado en la definición (o la constante).
    const rules = (Array.isArray(def?.decisionRules) ? def!.decisionRules : DEFAULT_DECISION_RULES) as {
      tipo: string;
      slaHours: number;
      order: string;
      method?: string;
    }[];
    const match = rules.find((r) => r.tipo === tipo) ?? rules.find((r) => r.tipo === '*');
    return {
      tipo,
      slaHours: match?.slaHours ?? 48,
      order: match?.order ?? 'SECUENCIAL',
      method: match?.method,
      hitPolicy: 'FIRST',
      source: def?.decisionRules ? ('rules' as const) : ('default' as const),
      matchedRules: match ? [match.tipo] : [],
    };
  }

  /**
   * Auditoría del tenant. Si se filtra por un recurso, se comprueba antes que
   * pertenezca al tenant (404 si no).
   */
  async listAudit(
    params: { signatureRequestId?: string; documentId?: string; onboardingId?: string },
    tenantId: string,
  ) {
    if (params.signatureRequestId) {
      const r = await this.prisma.signatureRequest.findFirst({
        where: { id: params.signatureRequestId, tenantId },
        select: { id: true },
      });
      if (!r) throw new NotFoundException('Solicitud no encontrada');
    }
    if (params.documentId) {
      const d = await this.prisma.document.findFirst({
        where: { id: params.documentId, tenantId },
        select: { id: true },
      });
      if (!d) throw new NotFoundException('Documento no encontrado');
    }
    if (params.onboardingId) {
      const o = await this.prisma.onboardingCase.findFirst({
        where: { id: params.onboardingId, tenantId },
        select: { id: true },
      });
      if (!o) throw new NotFoundException('Onboarding no encontrado');
    }
    return this.prisma.processAuditEvent.findMany({
      where: {
        tenantId,
        signatureRequestId: params.signatureRequestId,
        documentId: params.documentId,
        onboardingId: params.onboardingId,
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }
}
