import { describe, expect, it, vi } from 'vitest';
import { WorkflowService } from './workflow.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { EvidenceService } from '../evidence/evidence.service';
import { NUDGE_MARKS, nudgeKindFor } from '../temporal/shared';

interface FakeTask {
  id: string;
  signatureRequestId: string;
  signerId: string;
  status: string;
  priority: number;
  remindersSent: number;
  lastReminderAt: Date | null;
  escalatedAt: Date | null;
  delegatedFrom: string | null;
}

function makeService(opts: {
  requestStatus?: string;
  requestedBy?: string | null;
  tasks: Partial<FakeTask>[];
  watchers?: { userId: string }[];
}) {
  const tasks = new Map<string, FakeTask>(
    opts.tasks.map((t, i) => {
      const id = t.id ?? `task-${i}`;
      return [
        id,
        {
          id,
          signatureRequestId: t.signatureRequestId ?? 'req-1',
          signerId: t.signerId ?? `signer-${i}`,
          status: t.status ?? 'ASIGNADA',
          priority: t.priority ?? 0,
          remindersSent: t.remindersSent ?? 0,
          lastReminderAt: t.lastReminderAt ?? null,
          escalatedAt: t.escalatedAt ?? null,
          delegatedFrom: t.delegatedFrom ?? null,
        },
      ];
    }),
  );
  const notifications: { userId: string; title: string }[] = [];
  const audits: { action: string; payload: unknown }[] = [];

  const prisma = {
    signatureRequest: {
      findUnique: async () => ({
        id: 'req-1',
        status: opts.requestStatus ?? 'EN_FIRMA',
        documentId: 'doc-1',
        requestedBy: opts.requestedBy === undefined ? 'maria' : opts.requestedBy,
        document: { filename: 'contrato.pdf' },
      }),
    },
    humanTask: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const status = (where.status as { in: string[] })?.in ?? [];
        return [...tasks.values()].filter(
          (t) =>
            t.signatureRequestId === where.signatureRequestId &&
            status.includes(t.status) &&
            (where.signerId ? t.signerId === where.signerId : true),
        );
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const t = tasks.get(where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in (v as object)) {
            (t as Record<string, unknown>)[k] =
              ((t as Record<string, number>)[k] ?? 0) + (v as { increment: number }).increment;
          } else {
            (t as Record<string, unknown>)[k] = v;
          }
        }
        return t;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        const orClauses = (where.OR as { signerId?: string; delegatedFrom?: string }[]) ?? null;
        for (const t of tasks.values()) {
          if (t.signatureRequestId !== where.signatureRequestId) continue;
          const status = (where.status as { in: string[] })?.in;
          if (status && !status.includes(t.status)) continue;
          if (where.signerId && t.signerId !== where.signerId) continue;
          if (
            orClauses &&
            !orClauses.some(
              (c) =>
                (c.signerId && c.signerId === t.signerId) ||
                (c.delegatedFrom && c.delegatedFrom === t.delegatedFrom),
            )
          ) {
            continue;
          }
          Object.assign(t, data);
          count += 1;
        }
        return { count };
      },
    },
    processWatcher: { findMany: async () => opts.watchers ?? [] },
    workflowRun: { findUnique: async () => null },
    userNotification: {
      create: async ({ data }: { data: { userId: string; title: string } }) => {
        notifications.push({ userId: data.userId, title: data.title });
        return data;
      },
    },
    processAuditEvent: {
      create: async ({ data }: { data: { action: string; payload: unknown } }) => {
        audits.push({ action: data.action, payload: data.payload });
        return data;
      },
    },
  } as unknown as PrismaService;

  const evidence = { generateForRequest: vi.fn() } as unknown as EvidenceService;
  return { service: new WorkflowService(prisma, evidence), tasks, notifications, audits };
}

describe('M07 — marcas de recordatorio', () => {
  it('las fracciones < 0.9 son recordatorio y >= 0.9 escalan', () => {
    expect(NUDGE_MARKS).toEqual([0.5, 0.75, 0.9]);
    expect(nudgeKindFor(0.5)).toBe('REMINDER');
    expect(nudgeKindFor(0.75)).toBe('REMINDER');
    expect(nudgeKindFor(0.9)).toBe('ESCALATION');
    expect(nudgeKindFor(1)).toBe('ESCALATION');
  });
});

describe('WorkflowService.nudge', () => {
  it('un REMINDER notifica al firmante e incrementa el contador', async () => {
    const { service, tasks, notifications, audits } = makeService({
      tasks: [{ id: 't1', signerId: 'ana', status: 'ASIGNADA' }],
    });
    const res = await service.nudge({ signatureRequestId: 'req-1', kind: 'REMINDER', ratio: 0.5 });
    expect(res).toMatchObject({ reminded: 1, escalated: 0 });
    expect(tasks.get('t1')?.remindersSent).toBe(1);
    expect(tasks.get('t1')?.lastReminderAt).toBeInstanceOf(Date);
    expect(notifications).toEqual([{ userId: 'ana', title: 'Recordatorio de firma' }]);
    expect(audits[0]).toMatchObject({ action: 'SIGNATURE_REMINDER' });
  });

  it('no repite el recordatorio dentro de la ventana anti-duplicado', async () => {
    const { service, notifications } = makeService({
      tasks: [{ id: 't1', signerId: 'ana', status: 'ASIGNADA', lastReminderAt: new Date() }],
    });
    const res = await service.nudge({ signatureRequestId: 'req-1', kind: 'REMINDER', ratio: 0.5 });
    expect(res).toMatchObject({ reminded: 0 });
    expect(notifications).toHaveLength(0);
  });

  it('un ESCALATION marca la tarea, sube prioridad y avisa al emisor y observadores', async () => {
    const { service, tasks, notifications, audits } = makeService({
      requestedBy: 'maria',
      watchers: [{ userId: 'auditor-1' }],
      tasks: [{ id: 't1', signerId: 'ana', status: 'ASIGNADA' }],
    });
    const res = await service.nudge({ signatureRequestId: 'req-1', kind: 'ESCALATION', ratio: 0.9 });
    expect(res).toMatchObject({ escalated: 1 });
    expect(tasks.get('t1')?.escalatedAt).toBeInstanceOf(Date);
    expect(tasks.get('t1')?.priority).toBe(2);
    expect(notifications.map((n) => n.userId).sort()).toEqual(['ana', 'auditor-1', 'maria']);
    expect(audits[0]).toMatchObject({ action: 'SIGNATURE_ESCALATED' });
  });

  it('no hace nada si la solicitud ya está cerrada', async () => {
    const { service, notifications } = makeService({
      requestStatus: 'COMPLETADA',
      tasks: [{ id: 't1', signerId: 'ana', status: 'ASIGNADA' }],
    });
    const res = await service.nudge({ signatureRequestId: 'req-1', kind: 'REMINDER', ratio: 0.5 });
    expect(res).toMatchObject({ skipped: true });
    expect(notifications).toHaveLength(0);
  });
});

describe('WorkflowService.reassignForDelegation', () => {
  it('mueve las tareas abiertas al delegado y guarda el origen', async () => {
    const { service, tasks } = makeService({
      tasks: [
        { id: 't1', signerId: 'ana', status: 'ASIGNADA' },
        { id: 't2', signerId: 'ana', status: 'COMPLETADA' },
      ],
    });
    await service.reassignForDelegation('req-1', 'ana', 'beto');
    expect(tasks.get('t1')).toMatchObject({ signerId: 'beto', delegatedFrom: 'ana', status: 'ASIGNADA' });
    expect(tasks.get('t2')).toMatchObject({ signerId: 'ana', status: 'COMPLETADA' });
  });

  it('signalSigned cierra la tarea aunque haya sido reasignada por delegación', async () => {
    const { service, tasks } = makeService({
      tasks: [{ id: 't1', signerId: 'beto', status: 'ASIGNADA', delegatedFrom: 'ana' }],
    });
    await service.signalSigned('req-1', 'ana');
    expect(tasks.get('t1')?.status).toBe('COMPLETADA');
  });
});
