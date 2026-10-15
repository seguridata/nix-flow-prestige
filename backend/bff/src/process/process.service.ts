import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, type ProcessDefinition } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { finishPage, pageArgs, prismaPage, type PageQueryDto } from '../common/pagination';
import { RedisService } from '../redis/redis.service';
import { evaluateDmn } from './dmn-engine';
import { flowToBpmn, validateFlow } from '../flow/flow';
import type { Flow } from '../flow/flow.types';
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
    return { tenantId: { in: [tenantId, PLATFORM_TENANT] } };
  }

  async list(tenantId: string, page?: PageQueryDto) {
    const args = pageArgs(page);
    // Orden de dominio estable (key asc, version desc, id desc).
    const orderBy = [{ key: 'asc' as const }, { version: 'desc' as const }, { id: 'desc' as const }];
    const where = this.readable(tenantId);
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
  listPublished(tenantId: string) {
    return this.prisma.processDefinition.findMany({
      where: { ...this.readable(tenantId), published: true },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
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
    const [, published] = await this.prisma.$transaction([
      this.prisma.processDefinition.updateMany({ where: { tenantId, key, version: { not: version } }, data: { published: false } }),
      this.prisma.processDefinition.update({ where: { id: target.id }, data: { published: true, publishedAt: new Date() } }),
    ]);
    await this.invalidateProcessCache(tenantId, key);
    return published;
  }

  async unpublish(key: string, version: number, tenantId: string) {
    const target = await this.ownVersion(key, version, tenantId);
    const updated = await this.prisma.processDefinition.update({
      where: { id: target.id },
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
        published: true,
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
