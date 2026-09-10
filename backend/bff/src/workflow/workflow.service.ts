import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceService } from '../evidence/evidence.service';
import {
  CONTRATO_DOS_PARTES,
  PRESTIGE_TASK_QUEUE,
  type ContratoWorkflowInput,
  type ContratoWorkflowState,
  type NudgeCommand,
} from '../temporal/shared';

/** Ventana anti-duplicado para reintentos de Temporal sobre el mismo aviso. */
const NUDGE_DEDUPE_MS = 30 * 60_000;
const CLOSED_REQUEST = ['COMPLETADA', 'RECHAZADA', 'EXPIRADA'];
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
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    });
    return tasks.map((task) => ({
      id: task.id,
      name: task.name,
      processInstanceId: task.workflowId ?? task.signatureRequestId,
      candidateGroups: params.candidateGroup ? [params.candidateGroup] : [],
      dueDate: task.dueAt?.toISOString() ?? null,
      status: task.status,
      priority: task.priority,
      signerId: task.signerId,
      signatureRequestId: task.signatureRequestId,
      claimedBy: task.claimedBy,
      claimedAt: task.claimedAt?.toISOString() ?? null,
      outcome: task.outcome,
      remindersSent: task.remindersSent,
      lastReminderAt: task.lastReminderAt?.toISOString() ?? null,
      escalatedAt: task.escalatedAt?.toISOString() ?? null,
      delegatedFrom: task.delegatedFrom,
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
      where: {
        signatureRequestId,
        status: { in: ['CREADA', 'ASIGNADA'] },
        OR: [{ signerId }, { delegatedFrom: signerId }],
      },
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
    // Idempotente frente a reintentos del activity de Temporal.
    const existing = await this.prisma.humanTask.count({
      where: { signatureRequestId: input.signatureRequestId },
    });
    if (existing > 0) return;

    const dueAt = new Date(Date.now() + input.slaHours * 3600_000);

    // La delegación (manual o por «fuera de oficina») ya quedó en `Signer`;
    // aquí sólo se refleja en el asignatario de la tarea.
    const signerRows = await this.prisma.signer.findMany({
      where: { signatureRequestId: input.signatureRequestId },
    });
    const delegatedBy = new Map(
      signerRows.filter((s) => s.delegatedTo).map((s) => [s.signerId, s.delegatedTo as string]),
    );

    for (const signer of input.signers) {
      const delegate = delegatedBy.get(signer.signerId);
      await this.prisma.humanTask.create({
        data: {
          signatureRequestId: input.signatureRequestId,
          signerId: delegate ?? signer.signerId,
          delegatedFrom: delegate ? signer.signerId : null,
          name: `Firma — ${signer.name ?? signer.signerId}`,
          status: 'ASIGNADA',
          dueAt,
          workflowId,
        },
      });
    }
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

  /**
   * M07 — un timer del workflow pide un recordatorio (`REMINDER`) o un
   * escalamiento (`ESCALATION`) sobre las tareas de firma aún abiertas.
   * Crea notificaciones y eventos de auditoría reales; es idempotente frente a
   * los reintentos de Temporal gracias a la ventana `NUDGE_DEDUPE_MS`.
   */
  async nudge(cmd: NudgeCommand) {
    const request = await this.prisma.signatureRequest.findUnique({
      where: { id: cmd.signatureRequestId },
      include: { document: true },
    });
    if (!request || CLOSED_REQUEST.includes(request.status)) {
      return { skipped: true as const, reminded: 0, escalated: 0 };
    }

    const openTasks = await this.prisma.humanTask.findMany({
      where: {
        signatureRequestId: cmd.signatureRequestId,
        status: { in: ['CREADA', 'ASIGNADA'] },
        ...(cmd.signerId ? { signerId: cmd.signerId } : {}),
      },
    });
    if (openTasks.length === 0) return { skipped: false as const, reminded: 0, escalated: 0 };

    const now = Date.now();
    const docTitle = request.document?.filename ?? 'un documento';
    let reminded = 0;
    let escalated = 0;

    let escalationRecipients: string[] = [];
    if (cmd.kind === 'ESCALATION') {
      const watchers = await this.prisma.processWatcher.findMany({
        where: { signatureRequestId: cmd.signatureRequestId },
      });
      escalationRecipients = [
        ...new Set([
          ...(request.requestedBy ? [request.requestedBy] : []),
          ...watchers.map((w) => w.userId),
        ]),
      ];
    }

    for (const task of openTasks) {
      if (cmd.kind === 'REMINDER') {
        if (task.lastReminderAt && now - task.lastReminderAt.getTime() < NUDGE_DEDUPE_MS) continue;
        await this.prisma.humanTask.update({
          where: { id: task.id },
          data: { remindersSent: { increment: 1 }, lastReminderAt: new Date() },
        });
        await this.notifyUser(
          task.signerId,
          'Recordatorio de firma',
          `Sigue pendiente tu firma de «${docTitle}».`,
          '/inbox',
        );
        await this.auditSystem(cmd.signatureRequestId, request.documentId, 'SIGNATURE_REMINDER', {
          signerId: task.signerId,
          ratio: cmd.ratio,
          remindersSent: task.remindersSent + 1,
        });
        reminded += 1;
      } else {
        if (task.escalatedAt && now - task.escalatedAt.getTime() < NUDGE_DEDUPE_MS) continue;
        await this.prisma.humanTask.update({
          where: { id: task.id },
          data: { escalatedAt: new Date(), priority: Math.max(task.priority, 2) },
        });
        for (const uid of [...new Set([...escalationRecipients, task.signerId])]) {
          await this.notifyUser(
            uid,
            'Escalamiento de firma',
            `La firma de ${task.signerId} en «${docTitle}» venció su SLA.`,
            uid === task.signerId ? '/inbox' : '/sent',
          );
        }
        await this.auditSystem(cmd.signatureRequestId, request.documentId, 'SIGNATURE_ESCALATED', {
          signerId: task.signerId,
          ratio: cmd.ratio,
          notified: [...new Set([...escalationRecipients, task.signerId])],
        });
        escalated += 1;
      }
    }

    return { skipped: false as const, reminded, escalated };
  }

  /**
   * M07 — reasigna las tareas de firma abiertas de `fromSignerId` a
   * `toSignerId` (delegación / «fuera de oficina»), dejando traza del origen.
   */
  async reassignForDelegation(signatureRequestId: string, fromSignerId: string, toSignerId: string) {
    await this.prisma.humanTask.updateMany({
      where: {
        signatureRequestId,
        signerId: fromSignerId,
        status: { in: ['CREADA', 'ASIGNADA'] },
      },
      data: {
        signerId: toSignerId,
        delegatedFrom: fromSignerId,
        claimedBy: null,
        claimedAt: null,
        status: 'ASIGNADA',
      },
    });
  }

  private notifyUser(userId: string, title: string, body: string, href?: string) {
    return this.prisma.userNotification.create({ data: { userId, title, body, href } });
  }

  private auditSystem(
    signatureRequestId: string,
    documentId: string | undefined,
    action: string,
    payload: Record<string, unknown>,
  ) {
    return this.prisma.processAuditEvent.create({
      data: { signatureRequestId, documentId, actorId: 'system', action, payload: payload as object },
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
