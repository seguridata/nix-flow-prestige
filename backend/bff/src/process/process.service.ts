import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

@Injectable()
export class ProcessService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSeeds();
  }

  async ensureSeeds() {
    for (const seed of SEEDS) {
      const existing = await this.prisma.processDefinition.findFirst({
        where: { key: seed.key },
        orderBy: { version: 'desc' },
      });
      if (!existing) {
        await this.prisma.processDefinition.create({ data: seed });
      }
    }
  }

  list() {
    return this.prisma.processDefinition.findMany({
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
  }

  async getLatest(key: string) {
    const found = await this.prisma.processDefinition.findFirst({
      where: { key },
      orderBy: { version: 'desc' },
    });
    if (!found) throw new NotFoundException(`Proceso ${key} no encontrado`);
    return found;
  }

  async saveXml(key: string, body: { bpmnXml?: string; dmnXml?: string; name?: string }) {
    const latest = await this.prisma.processDefinition.findFirst({
      where: { key },
      orderBy: { version: 'desc' },
    });
    if (!latest) throw new NotFoundException(`Proceso ${key} no encontrado`);
    return this.prisma.processDefinition.create({
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

  listAudit(params: { signatureRequestId?: string; documentId?: string; onboardingId?: string }) {
    return this.prisma.processAuditEvent.findMany({
      where: {
        signatureRequestId: params.signatureRequestId,
        documentId: params.documentId,
        onboardingId: params.onboardingId,
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }
}
