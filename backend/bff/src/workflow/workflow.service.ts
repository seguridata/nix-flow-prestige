import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import { PrismaService } from '../prisma/prisma.service';
import { STABLE_ORDER, finishPage, mapPage, pageArgs, prismaPage, type PageQueryDto } from '../common/pagination';
import { EvidenceService } from '../evidence/evidence.service';
import { SignerMailService } from '../notifications/signer-mail.service';
import { AuditChainService } from '../collaboration/audit-chain.service';
import {
  CONTRATO_DOS_PARTES,
  PRESTIGE_TASK_QUEUE,
  type ContratoWorkflowInput,
  type ContratoWorkflowState,
  type NudgeCommand,
} from '../temporal/shared';

/**
 * Ventana anti-duplicado para reintentos del activity de Temporal sobre el
 * MISMO aviso (los reintentos ocurren en segundos). Corta para no tragarse las
 * marcas legítimas 50/75/90 % cuando el SLA es de pocas horas.
 */
const NUDGE_DEDUPE_MS = 90_000;
const CLOSED_REQUEST = ['COMPLETADA', 'RECHAZADA', 'EXPIRADA'];
const SIGN_SIGNAL = 'signCompleted';
const REJECT_SIGNAL = 'rejected';
const CANCEL_SIGNAL = 'cancelled';
const STATE_QUERY = 'getState';
const OPEN_TASK: Array<'CREADA' | 'ASIGNADA'> = ['CREADA', 'ASIGNADA'];

/** Usuario autenticado tal como lo entrega JwtAuthGuard + TenantContextGuard. */
export interface WorkflowActor {
  actorId: string;
  tenantId: string;
  roles: string[];
}

const isAdmin = (u: WorkflowActor) => u.roles.includes('admin') || u.roles.includes('platform_admin');

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
    private readonly mail: SignerMailService,
    private readonly auditChain: AuditChainService,
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

  /**
   * Entrada para el endpoint HTTP: valida que `caseId` y
   * `variables.signatureRequestId` pertenezcan al tenant del usuario (404 si
   * no) y exige rol sender/admin. Los llamadores internos de confianza (p. ej.
   * SignatureRequestsService al crear una solicitud) usan `startInstance`.
   */
  async startInstanceForUser(
    user: WorkflowActor,
    processDefinitionKey: string,
    businessKey: string,
    variables: Record<string, unknown>,
  ) {
    if (!user.roles.includes('sender') && !isAdmin(user)) {
      throw new ForbiddenException('Requiere rol sender o admin');
    }
    const signatureRequestId = String(variables.signatureRequestId ?? businessKey);
    const request = await this.prisma.signatureRequest.findFirst({
      where: { id: signatureRequestId, tenantId: user.tenantId },
      select: { id: true, order: true, documentId: true },
    });
    if (!request) throw new NotFoundException('Solicitud de firma no encontrada');
    // `caseId` puede ser un Case real o el id de la propia solicitud.
    if (businessKey !== signatureRequestId) {
      const kase = await this.prisma.case.findFirst({
        where: { id: businessKey, tenantId: user.tenantId },
        select: { id: true },
      });
      if (!kase) throw new NotFoundException('Caso no encontrado');
    }
    // Lo que alimenta al workflow sale de la BD, no del cliente.
    const signerRows = await this.prisma.signer.findMany({
      where: { signatureRequestId },
      orderBy: { sortOrder: 'asc' },
    });
    return this.startInstance(
      processDefinitionKey,
      businessKey,
      {
        ...variables,
        signatureRequestId,
        order: request.order,
        documentId: request.documentId,
        signers: signerRows.map((x) => ({ signerId: x.signerId, name: x.name ?? undefined })),
      },
      user.tenantId,
    );
  }

  async startInstance(
    processDefinitionKey: string,
    businessKey: string,
    variables: Record<string, unknown>,
    tenantId?: string,
  ) {
    const signatureRequestId = String(variables.signatureRequestId ?? businessKey);
    const tenant = tenantId ?? (await this.tenantOfRequest(signatureRequestId));
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
          tenantId: tenant,
          signatureRequestId,
          workflowId,
          runId: handle.firstExecutionRunId,
          taskQueue: PRESTIGE_TASK_QUEUE,
          processKey: processDefinitionKey,
          status: 'ACTIVO',
        },
        update: {
          workflowId,
          runId: handle.firstExecutionRunId,
          status: 'ACTIVO',
          lastError: null,
          tenantId: tenant,
        },
      });
      return { id: workflowId, processDefinitionKey, caseId: businessKey, status: 'ACTIVO' as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`Temporal no arrancó el flujo: ${message}`);
      await this.seedTasks(input, workflowId, tenant);
      await this.prisma.workflowRun.upsert({
        where: { signatureRequestId },
        create: {
          tenantId: tenant,
          signatureRequestId,
          workflowId,
          taskQueue: PRESTIGE_TASK_QUEUE,
          processKey: processDefinitionKey,
          status: 'LOCAL',
          lastError: message,
        },
        update: { status: 'LOCAL', lastError: message, tenantId: tenant },
      });
      return { id: workflowId, processDefinitionKey, caseId: businessKey, status: 'ACTIVO' as const };
    }
  }

  async describe(signatureRequestId: string, tenantId: string) {
    const owned = await this.prisma.signatureRequest.findFirst({
      where: { id: signatureRequestId, tenantId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Solicitud de firma no encontrada');
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

  async listRuns(tenantId: string, page?: PageQueryDto) {
    // Antes: take 50 fijo. Sin limit/cursor sigue devolviendo array (tope 200).
    const args = pageArgs(page);
    const rows = await this.prisma.workflowRun.findMany({
      where: { OR: [{ tenantId }, { tenantId: null, signatureRequest: { tenantId } }] },
      orderBy: STABLE_ORDER,
      ...prismaPage(args),
    });
    return finishPage(rows, args);
  }

  async listTasks(
    params: { assignee?: string; candidateGroup?: string; tenantId?: string },
    page?: PageQueryDto,
  ) {
    const args = pageArgs(page);
    const tasks = await this.prisma.humanTask.findMany({
      where: {
        ...(params.assignee ? { signerId: params.assignee } : {}),
        ...(params.tenantId
          ? {
              OR: [
                { tenantId: params.tenantId },
                { tenantId: null, signatureRequest: { tenantId: params.tenantId } },
              ],
            }
          : {}),
      },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      ...prismaPage(args),
    });
    return mapPage(finishPage(tasks, args), (task) => ({
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

  /** Carga la tarea por {id, tenantId}: otro tenant => 404 (no revela existencia). */
  private async loadTask(taskId: string, tenantId: string) {
    const task = await this.prisma.humanTask.findFirst({
      where: {
        id: taskId,
        OR: [{ tenantId }, { tenantId: null, signatureRequest: { tenantId } }],
      },
    });
    if (!task) throw new NotFoundException(`Tarea ${taskId} no encontrada`);
    return task;
  }

  private assertTaskActor(task: { signerId: string; claimedBy: string | null }, user: WorkflowActor) {
    if (isAdmin(user) || task.signerId === user.actorId || task.claimedBy === user.actorId) return;
    throw new ForbiddenException('La tarea no está asignada a ti');
  }

  async completeTask(taskId: string, variables: Record<string, unknown>, user: WorkflowActor) {
    const task = await this.loadTask(taskId, user.tenantId);
    this.assertTaskActor(task, user);
    // Cierre condicionado a que siga abierta (dos completes no la cierran dos veces).
    const res = await this.prisma.humanTask.updateMany({
      where: { id: task.id, status: { in: OPEN_TASK } },
      data: {
        status: 'COMPLETADA',
        completedAt: new Date(),
        outcome: typeof variables.outcome === 'string' ? variables.outcome : 'COMPLETADA',
      },
    });
    if (res.count !== 1) throw new BadRequestException(`La tarea ${taskId} ya no está abierta`);
    return { ok: true };
  }

  async claimTask(taskId: string, user: WorkflowActor) {
    const task = await this.loadTask(taskId, user.tenantId);
    if (!(OPEN_TASK as string[]).includes(task.status)) {
      throw new BadRequestException(`La tarea ${taskId} ya no está abierta`);
    }
    if (!isAdmin(user) && task.signerId !== user.actorId) {
      throw new ForbiddenException('La tarea no está asignada a ti');
    }
    if (!isAdmin(user) && task.claimedBy && task.claimedBy !== user.actorId) {
      throw new ForbiddenException('La tarea ya fue reclamada por otra persona');
    }
    return this.prisma.humanTask.update({
      where: { id: task.id },
      data: { claimedBy: user.actorId, claimedAt: new Date(), status: 'ASIGNADA' },
    });
  }

  async reassignTask(taskId: string, targetUserId: string, user: WorkflowActor) {
    const task = await this.loadTask(taskId, user.tenantId);
    this.assertTaskActor(task, user);
    // El destino debe ser miembro activo del tenant (directorio real).
    const member = await this.prisma.tenantMembership.findFirst({
      where: { userId: targetUserId, active: true, tenant: { slug: user.tenantId, active: true } },
      select: { id: true },
    });
    if (!member) throw new BadRequestException('El destinatario no pertenece a este tenant');
    return this.prisma.humanTask.update({
      where: { id: task.id },
      data: { signerId: targetUserId, claimedBy: targetUserId, claimedAt: new Date(), status: 'ASIGNADA' },
    });
  }

  /**
   * Cancela el flujo de una solicitud: emite la señal `cancelled` a Temporal
   * (el workflow termina en CANCELADO), cancela las tareas abiertas y marca el
   * WorkflowRun. NO valida tenant ni permisos: el llamador (p. ej.
   * `SignatureRequestsService.cancel()`, que ya cargó la solicitud por tenant)
   * debe haberlo hecho. Idempotente y tolerante a que Temporal no esté.
   */
  async cancelRun(signatureRequestId: string) {
    await this.prisma.humanTask.updateMany({
      where: { signatureRequestId, status: { in: OPEN_TASK } },
      data: { status: 'CANCELADA' },
    });
    await this.prisma.workflowRun.updateMany({
      where: { signatureRequestId },
      data: { status: 'CANCELADO' },
    });
    const run = await this.prisma.workflowRun.findUnique({ where: { signatureRequestId } });
    if (!run?.workflowId) return;
    try {
      const client = await this.client();
      await client.workflow.getHandle(run.workflowId).signal(CANCEL_SIGNAL);
    } catch (error) {
      this.log.warn(`cancelSignal Temporal omitido: ${(error as Error).message}`);
    }
  }

  private async tenantOfRequest(signatureRequestId: string): Promise<string | undefined> {
    const r = await this.prisma.signatureRequest.findUnique({
      where: { id: signatureRequestId },
      select: { tenantId: true },
    });
    return r?.tenantId;
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

  async seedTasks(input: ContratoWorkflowInput, workflowId?: string, tenantId?: string) {
    const tenant = tenantId ?? (await this.tenantOfRequest(input.signatureRequestId));
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
          tenantId: tenant,
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
        // En orden SECUENCIAL el workflow apunta al firmante del orden; si está
        // «fuera de oficina» la tarea vive bajo el suplente (`delegatedFrom`).
        ...(cmd.signerId
          ? { OR: [{ signerId: cmd.signerId }, { delegatedFrom: cmd.signerId }] }
          : {}),
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
        await this.mail
          .sendReminder(cmd.signatureRequestId, task.signerId, cmd.ratio ?? 0.5)
          .catch(() => undefined);
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
        await this.mail
          .sendEscalation(cmd.signatureRequestId, task.delegatedFrom ?? task.signerId, cmd.ratio ?? 0.9)
          .catch(() => undefined);
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
        // Re-delegación: la tarea puede estar ya bajo un suplente anterior.
        OR: [{ signerId: fromSignerId }, { delegatedFrom: fromSignerId }],
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
    // M11 — por la cadena inmutable, igual que el resto de la auditoría.
    return this.auditChain.append({ signatureRequestId, documentId, actorId: 'system', action, payload });
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
