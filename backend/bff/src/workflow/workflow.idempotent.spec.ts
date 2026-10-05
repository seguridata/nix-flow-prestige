import { describe, expect, it, vi } from 'vitest';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { WorkflowService } from './workflow.service';
import type { PrismaService } from '../prisma/prisma.service';

function setup(startImpl: () => Promise<unknown>) {
  const run: Record<string, unknown> = {
    signatureRequestId: 'sr-1',
    workflowId: 'contrato:sr-1',
    runId: 'run-0',
    status: 'ACTIVO',
    lastError: null,
  };
  const upsert = vi.fn(async ({ update }: { update: Record<string, unknown> }) => {
    Object.assign(run, update);
    return run;
  });
  const seed = vi.fn();
  const prisma = { workflowRun: { upsert } } as unknown as PrismaService;
  const svc = new WorkflowService(prisma, {} as never, {} as never, {} as never);
  (svc as unknown as { clientPromise: Promise<unknown> }).clientPromise = Promise.resolve({
    workflow: { start: startImpl },
  });
  (svc as unknown as { seedTasks: unknown }).seedTasks = seed;
  return { svc, run, upsert, seed };
}

describe('WorkflowService.startInstance idempotente', () => {
  it('WorkflowExecutionAlreadyStartedError: deja el WorkflowRun intacto y devuelve ACTIVO', async () => {
    const { svc, run, seed } = setup(async () => {
      throw new WorkflowExecutionAlreadyStartedError('Workflow execution already started', 'contrato:sr-1', 'contrato');
    });
    const before = { ...run };
    const r = await svc.startInstance('contrato', 'case-1', { signatureRequestId: 'sr-1' }, 'tenant-a');
    expect(r.status).toBe('ACTIVO');
    expect(run).toEqual(before);
    expect(run.status).not.toBe('LOCAL');
    expect(run.lastError).toBeNull();
    expect(seed).not.toHaveBeenCalled();
  });

  it('otro error de Temporal sigue degradando a LOCAL con lastError', async () => {
    const { svc, run, seed } = setup(async () => {
      throw new Error('UNAVAILABLE');
    });
    await svc.startInstance('contrato', 'case-1', { signatureRequestId: 'sr-1' }, 'tenant-a');
    expect(run.status).toBe('LOCAL');
    expect(run.lastError).toBe('UNAVAILABLE');
    expect(seed).toHaveBeenCalled();
  });
});
