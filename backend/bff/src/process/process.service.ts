import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

  decide(tipo: string) {
    const rules = DEFAULT_DECISION_RULES;
    const match = rules.find((r) => r.tipo === tipo.toLowerCase()) ?? rules.find((r) => r.tipo === '*');
    return {
      tipo,
      slaHours: match?.slaHours ?? 48,
      order: match?.order ?? 'SECUENCIAL',
      hitPolicy: 'FIRST',
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
