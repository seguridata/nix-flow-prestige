import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceService } from '../evidence/evidence.service';
import {
  CONTRATO_DOS_PARTES,
  PRESTIGE_TASK_QUEUE,
  type ContratoWorkflowInput,
  type ContratoWorkflowState,
} from '../temporal/shared';
const SIGN_SIGNAL = 'signCompleted';
const REJECT_SIGNAL = 'rejected';
const STATE_QUERY = 'getState';

/**
 * Workflow Port: único lugar que conoce Temporal.
 * La bandeja y el portal leen HumanTask / WorkflowRun en Postgres.
 */
@Injectable()
export class WorkflowService {
  private readonly log = new Logger(WorkflowService.name);
  private clientPromise: Promise<Client> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
  ) {}

  private async client(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const connection = await Connection.connect({
          address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
        });
        return new Client({
          connection,
          namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
        });
      })();
    }
    return this.clientPromise;
  }

  async startInstance(processDefinitionKey: string, businessKey: string, variables: Record<string, unknown>) {
    const signatureRequestId = String(variables.signatureRequestId ?? businessKey);
    const input: ContratoWorkflowInput = {
      signatureRequestId,
      documentId: String(variables.documentId ?? ''),
      caseId: businessKey,
      order: (variables.order as ContratoWorkflowInput['order']) ?? 'SECUENCIAL',
      slaHours: Number(variables.slaHours ?? 72),
      signers: (variables.signers as ContratoWorkflowInput['signers']) ?? [],
    };
    const workflowId = `${processDefinitionKey}:${signatureRequestId}`;

    try {
      const client = await this.client();
      const handle = await client.workflow.start(CONTRATO_DOS_PARTES, {
        taskQueue: PRESTIGE_TASK_QUEUE,
        workflowId,
        args: [input],
      });
      await this.prisma.workflowRun.upsert({
        where: { signatureRequestId },
        create: {
          signatureRequestId,
          workflowId,
          runId: handle.firstExecutionRunId,
          taskQueue: PRESTIGE_TASK_QUEUE,
          processKey: processDefinitionKey,
          status: 'ACTIVO',
        },
        update: { workflowId, runId: handle.firstExecutionRunId, status: 'ACTIVO', lastError: null },
      });
      return { id: workflowId, processDefinitionKey, caseId: businessKey, status: 'ACTIVO' as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`Temporal no arrancó el flujo: ${message}`);
      await this.seedTasks(input, workflowId);
      await this.prisma.workflowRun.upsert({
        where: { signatureRequestId },
        create: {
          signatureRequestId,
          workflowId,
          taskQueue: PRESTIGE_TASK_QUEUE,
          processKey: processDefinitionKey,
          status: 'LOCAL',
          lastError: message,
        },
        update: { status: 'LOCAL', lastError: message },
      });
      return { id: workflowId, processDefinitionKey, caseId: businessKey, status: 'ACTIVO' as const };
    }
  }

  async describe(signatureRequestId: string) {
    const run = await this.prisma.workflowRun.findUnique({ where: { signatureRequestId } });
    const tasks = await this.prisma.humanTask.findMany({
      where: { signatureRequestId },
      orderBy: { createdAt: 'asc' },
    });
    let live: ContratoWorkflowState | null = null;
    if (run?.workflowId) {
      try {
        const client = await this.client();
        live = await client.workflow.getHandle(run.workflowId).query(STATE_QUERY);
      } catch (error) {
        if (!(error instanceof WorkflowNotFoundError)) {
          this.log.debug(`query Temporal: ${(error as Error).message}`);
        }
      }
    }
    return { run, tasks, live };
  }

  async listRuns() {
    return this.prisma.workflowRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async listTasks(params: { assignee?: string; candidateGroup?: string }) {
    const tasks = await this.prisma.humanTask.findMany({
      where: params.assignee ? { signerId: params.assignee } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return tasks.map((task) => ({
      id: task.id,
      name: task.name,
      processInstanceId: task.workflowId ?? task.signatureRequestId,
      candidateGroups: params.candidateGroup ? [params.candidateGroup] : [],
      dueDate: task.dueAt?.toISOString() ?? null,
      status: task.status,
      signerId: task.signerId,
      signatureRequestId: task.signatureRequestId,
      claimedBy: task.claimedBy,
      claimedAt: task.claimedAt?.toISOString() ?? null,
      outcome: task.outcome,
    }));
  }

  async completeTask(taskId: string, variables: Record<string, unknown> = {}) {
    const task = await this.prisma.humanTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Tarea ${taskId} no encontrada`);
    await this.prisma.humanTask.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETADA',
        completedAt: new Date(),
        outcome: typeof variables.outcome === 'string' ? variables.outcome : 'COMPLETADA',
      },
    });
    return { ok: true };
  }

  async claimTask(taskId: string, userId: string) {
    const task = await this.prisma.humanTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Tarea ${taskId} no encontrada`);
    if (!['CREADA', 'ASIGNADA'].includes(task.status)) {
      throw new BadRequestException(`La tarea ${taskId} ya no está abierta`);
    }
    return this.prisma.humanTask.update({
      where: { id: taskId },
      data: { claimedBy: userId, claimedAt: new Date(), status: 'ASIGNADA' },
    });
  }

  async reassignTask(taskId: string, userId: string) {
    const task = await this.prisma.humanTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Tarea ${taskId} no encontrada`);
    return this.prisma.humanTask.update({
      where: { id: taskId },
      data: { signerId: userId, claimedBy: userId, claimedAt: new Date(), status: 'ASIGNADA' },
    });
  }

  async signalSigned(signatureRequestId: string, signerId: string) {
    await this.prisma.humanTask.updateMany({
      where: { signatureRequestId, signerId, status: { in: ['CREADA', 'ASIGNADA'] } },
      data: { status: 'COMPLETADA', completedAt: new Date() },
    });
    await this.signal(signatureRequestId, 'sign', signerId);
  }

  async signalRejected(signatureRequestId: string, signerId: string) {
    await this.prisma.humanTask.updateMany({
      where: { signatureRequestId, status: { in: ['CREADA', 'ASIGNADA'] } },
      data: { status: 'CANCELADA' },
    });
    await this.signal(signatureRequestId, 'reject', signerId);
  }

  async seedTasks(input: ContratoWorkflowInput, workflowId?: string) {
    const dueAt = new Date(Date.now() + input.slaHours * 3600_000);
    await this.prisma.humanTask.createMany({
      data: input.signers.map((signer) => ({
        signatureRequestId: input.signatureRequestId,
        signerId: signer.signerId,
        name: `Firma — ${signer.name ?? signer.signerId}`,
        status: 'ASIGNADA' as const,
        dueAt,
        workflowId,
      })),
    });
  }

  async expire(signatureRequestId: string) {
    await this.prisma.signatureRequest.updateMany({
      where: { id: signatureRequestId, status: { in: ['PENDIENTE', 'EN_FIRMA'] } },
      data: { status: 'EXPIRADA' },
    });
    await this.prisma.humanTask.updateMany({
      where: { signatureRequestId, status: { in: ['CREADA', 'ASIGNADA'] } },
      data: { status: 'EXPIRADA' },
    });
    await this.prisma.workflowRun.updateMany({
      where: { signatureRequestId },
      data: { status: 'EXPIRADO' },
    });
  }

  async seal(signatureRequestId: string) {
    await this.evidence.generateForRequest(signatureRequestId);
    await this.prisma.workflowRun.updateMany({
      where: { signatureRequestId },
      data: { status: 'COMPLETADO' },
    });
  }

  private async signal(signatureRequestId: string, kind: 'sign' | 'reject', signerId: string) {
    const run = await this.prisma.workflowRun.findUnique({ where: { signatureRequestId } });
    if (!run?.workflowId) return;
    try {
      const client = await this.client();
      const handle = client.workflow.getHandle(run.workflowId);
      if (kind === 'sign') await handle.signal(SIGN_SIGNAL, { signerId });
      else await handle.signal(REJECT_SIGNAL, { signerId });
    } catch (error) {
      this.log.warn(`signal Temporal omitido: ${(error as Error).message}`);
    }
  }
}
