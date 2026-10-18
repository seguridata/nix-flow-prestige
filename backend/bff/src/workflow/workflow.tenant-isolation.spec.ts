import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { WorkflowService, type WorkflowActor } from './workflow.service';

type Row = Record<string, unknown>;

/** Filtra como Prisma: un where sin tenantId devolvería filas de otros tenants. */
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([k, v]) => v === undefined || (typeof v === 'object' ? true : row[k] === v));

function setup() {
  const tasks: Row[] = [
    { id: 't1', tenantId: 'A', signerId: 'maria', claimedBy: null, status: 'ASIGNADA', priority: 0, dueAt: null, createdAt: new Date(), signatureRequestId: 'srA' },
    { id: 't2', tenantId: 'B', signerId: 'maria', claimedBy: null, status: 'ASIGNADA', priority: 0, dueAt: null, createdAt: new Date(), signatureRequestId: 'srB' },
  ];
  const runs: Row[] = [
    { id: 'r1', tenantId: 'A', signatureRequestId: 'srA', createdAt: new Date() },
    { id: 'r2', tenantId: 'B', signatureRequestId: 'srB', createdAt: new Date() },
  ];
  const prisma = {
    humanTask: {
      findMany: async ({ where }: { where: Row }) => tasks.filter((t) => matches(t, where)),
      findFirst: async ({ where }: { where: Row }) => tasks.find((t) => matches(t, where)) ?? null,
    },
    workflowRun: { findMany: async ({ where }: { where: Row }) => runs.filter((r) => matches(r, where)) },
  };
  return new WorkflowService(prisma as never, {} as never, {} as never, {} as never);
}

const userA: WorkflowActor = { actorId: 'maria', tenantId: 'A', roles: ['signer'] };

describe('WorkflowService - el tenant A no lee datos del tenant B', () => {
  it('listRuns solo devuelve corridas del tenant', async () => {
    const out = (await setup().listRuns('A')) as unknown as Array<{ id: string }>;
    expect(out.map((r) => r.id)).toEqual(['r1']);
  });

  it('listTasks solo devuelve tareas del tenant, aunque el asignatario sea el mismo', async () => {
    const out = (await setup().listTasks({ assignee: 'maria', tenantId: 'A' })) as unknown as Array<{ id: string }>;
    expect(out.map((t) => t.id)).toEqual(['t1']);
  });

  it('reclamar una tarea de otro tenant responde 404', async () => {
    await expect(setup().claimTask('t2', userA)).rejects.toBeInstanceOf(NotFoundException);
  });
});
