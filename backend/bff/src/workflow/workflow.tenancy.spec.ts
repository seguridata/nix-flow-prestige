import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowService, type WorkflowActor } from './workflow.service';

type Task = { id: string; tenantId: string | null; signerId: string; claimedBy: string | null; status: string };

function make(tasks: Task[], opts: { members?: string[]; requests?: Array<{ id: string; tenantId: string }> } = {}) {
  const prisma = {
    humanTask: {
      findFirst: async ({ where }: { where: { id: string; OR: Array<{ tenantId: string | null }> } }) => {
        const tenant = where.OR[0].tenantId;
        return tasks.find((t) => t.id === where.id && t.tenantId === tenant) ?? null;
      },
      updateMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        const t = tasks.find((x) => x.id === where.id)!;
        if (!['CREADA', 'ASIGNADA'].includes(t.status)) return { count: 0 };
        t.status = 'COMPLETADA';
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const t = tasks.find((x) => x.id === where.id)!;
        Object.assign(t, data);
        return t;
      }),
    },
    tenantMembership: {
      findFirst: async ({ where }: { where: { userId: string } }) =>
        (opts.members ?? []).includes(where.userId) ? { id: 'm' } : null,
    },
    signatureRequest: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        (opts.requests ?? []).find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
    },
    case: { findFirst: async () => null },
    signer: { findMany: async () => [] },
  };
  return new WorkflowService(prisma as never, {} as never, {} as never, {} as never);
}

const user = (over: Partial<WorkflowActor> = {}): WorkflowActor => ({
  actorId: 'maria',
  tenantId: 'acme',
  roles: ['signer'],
  ...over,
});

describe('WorkflowService — aislamiento por tenant y asignatario', () => {
  it('tarea de otro tenant => 404', async () => {
    const svc = make([{ id: 't1', tenantId: 'otro', signerId: 'maria', claimedBy: null, status: 'ASIGNADA' }]);
    await expect(svc.completeTask('t1', {}, user())).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.claimTask('t1', user())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un usuario que no es el asignatario no puede completar ni reclamar (403), un admin sí', async () => {
    const svc = make([{ id: 't1', tenantId: 'acme', signerId: 'carlos', claimedBy: null, status: 'ASIGNADA' }]);
    await expect(svc.completeTask('t1', {}, user())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.claimTask('t1', user())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.completeTask('t1', {}, user({ roles: ['admin'] }))).resolves.toEqual({ ok: true });
  });

  it('el asignatario completa su tarea una sola vez', async () => {
    const svc = make([{ id: 't1', tenantId: 'acme', signerId: 'maria', claimedBy: null, status: 'ASIGNADA' }]);
    await expect(svc.completeTask('t1', {}, user())).resolves.toEqual({ ok: true });
    await expect(svc.completeTask('t1', {}, user())).rejects.toThrow();
  });

  it('reassign valida el destino contra TenantMembership', async () => {
    const tasks = [{ id: 't1', tenantId: 'acme', signerId: 'maria', claimedBy: null, status: 'ASIGNADA' }];
    const svc = make(tasks, { members: ['beto'] });
    await expect(svc.reassignTask('t1', 'intruso', user({ roles: ['admin'] }))).rejects.toThrow(/no pertenece/);
    await svc.reassignTask('t1', 'beto', user({ roles: ['admin'] }));
    expect(tasks[0].signerId).toBe('beto');
  });

  it('startInstanceForUser: solicitud de otro tenant => 404; sin rol sender/admin => 403', async () => {
    const svc = make([], { requests: [{ id: 'sr-1', tenantId: 'otro' }] });
    await expect(
      svc.startInstanceForUser(user({ roles: ['sender'] }), 'contratoDosPartes', 'sr-1', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.startInstanceForUser(user({ roles: ['signer'] }), 'contratoDosPartes', 'sr-1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
