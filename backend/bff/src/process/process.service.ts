import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { finishPage, pageArgs, prismaPage, type PageQueryDto } from '../common/pagination';
import { RedisService } from '../redis/redis.service';
import { evaluateDmn } from './dmn-engine';
import {
  CONTRATO_BPMN,
  DEFAULT_DECISION_RULES,
  ONBOARDING_BPMN,
  SLA_DMN,
} from './defaults';

const SEEDS = [
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
 * Las definiciones BPMN/DMN son catálogo de PLATAFORMA: no se parten por
 * tenant en este sprint (lectura abierta a cualquier usuario autenticado).
 * Mutarlas exige rol admin (ver ProcessController).
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

  private async invalidateProcessCache(key?: string) {
    await this.redis.del('process:list', ...(key ? [`process:latest:${key}`] : []));
  }

  async ensureSeeds() {
    for (const seed of SEEDS) {
      const existing = await this.prisma.processDefinition.findFirst({
        where: { key: seed.key },
        orderBy: { version: 'desc' },
      });
      if (!existing) {
        try {
          await this.prisma.processDefinition.create({ data: seed });
        } catch (error) {
          // Arranques paralelos (varias réplicas): @@unique([key, version]) → ya lo creó otra.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        }
      }
    }
  }

  async list(page?: PageQueryDto) {
    const args = pageArgs(page);
    // Orden de dominio estable (key asc, version desc, id desc).
    const orderBy = [{ key: 'asc' as const }, { version: 'desc' as const }, { id: 'desc' as const }];
    // Paginado: sin caché (la clave dependería del cursor). Sin limit/cursor: array con caché.
    if (args.paged) {
      const rows = await this.prisma.processDefinition.findMany({ orderBy, ...prismaPage(args) });
      return finishPage(rows, args);
    }
    // D10 — lectura caliente: el diseñador la pide seguido y cambia poco.
    return this.redis.withCache('process:list', 60, () =>
      this.prisma.processDefinition.findMany({ orderBy, ...prismaPage(args) }),
    );
  }

  async getLatest(key: string) {
    const found = await this.redis.withCache(`process:latest:${key}`, 60, () =>
      this.prisma.processDefinition.findFirst({
        where: { key },
        orderBy: { version: 'desc' },
      }),
    );
    if (!found) throw new NotFoundException(`Proceso ${key} no encontrado`);
    return found;
  }

  async saveXml(key: string, body: { bpmnXml?: string; dmnXml?: string; name?: string }) {
    const latest = await this.prisma.processDefinition.findFirst({
      where: { key },
      orderBy: { version: 'desc' },
    });
    if (!latest) throw new NotFoundException(`Proceso ${key} no encontrado`);
    const created = await this.prisma.processDefinition.create({
      data: {
        key,
        name: body.name ?? latest.name,
        description: latest.description,
        version: latest.version + 1,
        bpmnXml: body.bpmnXml ?? latest.bpmnXml,
        dmnXml: body.dmnXml ?? latest.dmnXml,
        decisionRules: latest.decisionRules === null ? undefined : latest.decisionRules,
        published: true,
      },
    });
    await this.invalidateProcessCache(key);
    return created;
  }

  private readonly log = new Logger(ProcessService.name);

  /**
   * Decide SLA / orden / método a partir de un contexto. Evalúa DE VERDAD el
   * `dmnXml` del proceso con el motor DMN (FEEL); si el proceso no tiene DMN,
   * evalúa el `decisionRules` guardado; como último recurso, la constante.
   */
  async decide(context: Record<string, unknown>, processKey = 'contrato-dos-partes') {
    const tipo = String(context.tipo ?? 'contrato').toLowerCase();
    const ctx = { ...context, tipo };

    const def = await this.prisma.processDefinition
      .findFirst({ where: { key: processKey }, orderBy: { version: 'desc' } })
      .catch(() => null);

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
