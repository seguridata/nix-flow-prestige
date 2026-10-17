import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowService } from './workflow.service';

interface Req {
  id: string;
  tenantId: string;
  status: string;
  documentId: string;
  requestedBy: string | null;
  document: { filename: string };
}

function make(opts: { request?: Req | null; run?: { workflowId: string } | null; tasks?: Array<Record<string, unknown>> } = {}) {
  const request =
    opts.request === undefined
      ? { id: 'sr-1', tenantId: 'acme', status: 'EN_FIRMA', documentId: 'd1', requestedBy: 'ana', document: { filename: 'c.pdf' } }
      : opts.request;
  const prisma = {
    signatureRequest: {
      findUnique: vi.fn(async () => request),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    humanTask: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => opts.tasks ?? []),
      update: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
      create: vi.fn(async () => ({})),
    },
    workflowRun: {
      findUnique: vi.fn(async () => opts.run ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      upsert: vi.fn(async () => ({})),
    },
    processWatcher: { findMany: vi.fn(async () => []) },
    userNotification: { create: vi.fn(async () => ({})) },
    signer: { findMany: vi.fn(async () => []) },
  };
  const evidence = { generateForRequest: vi.fn(async () => ({})) };
  const mail = { sendReminder: vi.fn(async () => undefined), sendEscalation: vi.fn(async () => undefined) };
  const audit = { append: vi.fn(async () => ({})) };
  const svc = new WorkflowService(prisma as never, evidence as never, mail as never, audit as never);
  return { svc, prisma, evidence, mail, audit };
}

describe('canal worker->BFF atado al tenant', () => {
  it('expire con tenant ajeno => 403 y no actúa', async () => {
    const { svc, prisma } = make();
    await expect(svc.expire('sr-1', 'otro')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.signatureRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.humanTask.updateMany).not.toHaveBeenCalled();
    expect(prisma.workflowRun.updateMany).not.toHaveBeenCalled();
  });

  it('seal con tenant ajeno => 403 y no genera evidencia', async () => {
    const { svc, evidence } = make();
    await expect(svc.seal('sr-1', 'otro')).rejects.toBeInstanceOf(ForbiddenException);
    expect(evidence.generateForRequest).not.toHaveBeenCalled();
  });

  it('nudge con tenant ajeno => 403 sin notificar', async () => {
    const { svc, prisma } = make();
    await expect(
      svc.nudge({ tenantId: 'otro', signatureRequestId: 'sr-1', kind: 'REMINDER', ratio: 0.5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userNotification.create).not.toHaveBeenCalled();
  });

  it('seed-tasks con tenant ajeno => 403 sin crear tareas', async () => {
    const { svc, prisma } = make();
    await expect(
      svc.seedTasksFromWorker(
        { tenantId: 'otro', signatureRequestId: 'sr-1', documentId: 'd1', order: 'PARALELO', slaHours: 1, signers: [{ signerId: 'x' }] },
        'contratoDosPartes',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.humanTask.create).not.toHaveBeenCalled();
  });

  it('solicitud inexistente => 404', async () => {
    const { svc } = make({ request: null });
    await expect(svc.expire('sr-x', 'acme')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('workflow antiguo sin tenantId: actúa deduciendo el tenant de la BD', async () => {
    const { svc, prisma } = make();
    await svc.expire('sr-1');
    expect(prisma.signatureRequest.updateMany).toHaveBeenCalledTimes(1);
  });

  it('expire es idempotente: dos llamadas no fallan y cada update es condicional', async () => {
    const { svc, prisma } = make();
    await svc.expire('sr-1', 'acme');
    await svc.expire('sr-1', 'acme');
    const calls = prisma.signatureRequest.updateMany.mock.calls as unknown as Array<[{ where: { status: { in: string[] } } }]>;
    expect(calls).toHaveLength(2);
    for (const [arg] of calls) expect(arg.where.status.in).toEqual(['PENDIENTE', 'EN_FIRMA']);
  });

  it('seal delega en generateForRequest, que devuelve el manifiesto existente (idempotente)', async () => {
    const { svc, evidence } = make();
    await svc.seal('sr-1', 'acme');
    await svc.seal('sr-1', 'acme');
    expect(evidence.generateForRequest).toHaveBeenCalledTimes(2);
    expect(evidence.generateForRequest).toHaveBeenCalledWith('sr-1', 'acme');
  });

  it('nudge: reintento inmediato no duplica recordatorio y la notificación lleva tenantId', async () => {
    const task = {
      id: 't1',
      signerId: 'luis',
      status: 'ASIGNADA',
      priority: 0,
      remindersSent: 0,
      lastReminderAt: null as Date | null,
      escalatedAt: null,
      delegatedFrom: null,
    };
    const { svc, prisma } = make({ tasks: [task] });
    (prisma.humanTask.update as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      task.lastReminderAt = new Date();
      return task;
    });
    const cmd = { tenantId: 'acme', signatureRequestId: 'sr-1', kind: 'REMINDER' as const, ratio: 0.5 };
    const first = await svc.nudge(cmd);
    const second = await svc.nudge(cmd);
    expect(first.reminded).toBe(1);
    expect(second.reminded).toBe(0);
    expect(prisma.userNotification.create).toHaveBeenCalledTimes(1);
    expect(prisma.userNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'luis', tenantId: 'acme' }),
    });
  });

  it('nudge sobre solicitud cerrada no hace nada', async () => {
    const { svc, prisma } = make({
      request: { id: 'sr-1', tenantId: 'acme', status: 'COMPLETADA', documentId: 'd', requestedBy: null, document: { filename: 'x' } },
    });
    const r = await svc.nudge({ tenantId: 'acme', signatureRequestId: 'sr-1', kind: 'ESCALATION', ratio: 0.9 });
    expect(r.skipped).toBe(true);
    expect(prisma.userNotification.create).not.toHaveBeenCalled();
  });
});

describe('id de workflow', () => {
  it('seed-tasks prefiere el WorkflowRun.workflowId guardado (workflow en curso con id antiguo)', async () => {
    const { svc, prisma } = make({ run: { workflowId: 'contratoDosPartes:sr-1' } });
    await svc.seedTasksFromWorker(
      { signatureRequestId: 'sr-1', documentId: 'd1', order: 'PARALELO', slaHours: 1, signers: [{ signerId: 'x' }] },
      'contratoDosPartes',
    );
    expect(prisma.humanTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ workflowId: 'contratoDosPartes:sr-1', tenantId: 'acme' }),
    });
  });

  it('sin fila: usa el id con tenant si se conoce, y la fórmula antigua si no', async () => {
    const { svc } = make();
    expect(await svc.resolveWorkflowId('sr-1', 'contratoDosPartes', 'acme')).toBe('acme:contratoDosPartes:sr-1');
    expect(await svc.resolveWorkflowId('sr-1', 'contratoDosPartes')).toBe('contratoDosPartes:sr-1');
  });

  it('startInstance NUEVO usa tenant:processKey:id, input.tenantId y memo tenantId', async () => {
    const { svc, prisma } = make();
    const start = vi.fn(async (..._a: unknown[]) => ({ firstExecutionRunId: 'r1' }));
    (svc as unknown as { clientPromise: Promise<unknown> }).clientPromise = Promise.resolve({ workflow: { start } });
    const out = await svc.startInstance('contratoDosPartes', 'sr-1', { signatureRequestId: 'sr-1' }, 'acme');
    expect(out.id).toBe('acme:contratoDosPartes:sr-1');
    const opts = start.mock.calls[0][1] as { workflowId: string; memo: unknown; args: Array<{ tenantId: string }> };
    expect(opts.workflowId).toBe('acme:contratoDosPartes:sr-1');
    expect(opts.memo).toEqual({ tenantId: 'acme' });
    expect(opts.args[0].tenantId).toBe('acme');
    expect(prisma.workflowRun.upsert).toHaveBeenCalled();
  });

  it('startInstance con fila previa conserva SU workflowId (no duplica el workflow en curso)', async () => {
    const { svc } = make({ run: { workflowId: 'contratoDosPartes:sr-1' } });
    const start = vi.fn(async (..._a: unknown[]) => ({ firstExecutionRunId: 'r1' }));
    (svc as unknown as { clientPromise: Promise<unknown> }).clientPromise = Promise.resolve({ workflow: { start } });
    const out = await svc.startInstance('contratoDosPartes', 'sr-1', { signatureRequestId: 'sr-1' }, 'acme');
    expect(out.id).toBe('contratoDosPartes:sr-1');
  });
});
