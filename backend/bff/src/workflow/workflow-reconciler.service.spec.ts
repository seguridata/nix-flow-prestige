import { describe, expect, it, vi } from 'vitest';
import { WorkflowNotFoundError } from '@temporalio/client';
import { WorkflowReconcilerService } from './workflow-reconciler.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkflowService } from './workflow.service';

type Run = {
  signatureRequestId: string;
  workflowId: string;
  processKey: string;
  tenantId: string;
  lastError: string | null;
};

function setup(opts: {
  describe: () => Promise<unknown>;
  reqStatus?: string;
  lastError?: string | null;
  lock?: boolean;
  connectFails?: boolean;
}) {
  const run: Run = {
    signatureRequestId: 'sr-1',
    workflowId: 'contrato:sr-1',
    processKey: 'contrato',
    tenantId: 't1',
    lastError: opts.lastError ?? null,
  };
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const findMany = vi.fn(async () => [run]);
  const prisma = {
    workflowRun: { findMany, updateMany },
    signatureRequest: {
      findUnique: vi.fn(async () => ({
        id: 'sr-1',
        status: opts.reqStatus ?? 'EN_FIRMA',
        documentId: 'd1',
        order: 'SECUENCIAL',
        tenantId: 't1',
        signers: [{ signerId: 's1', name: 'S' }],
      })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: async () => [{ locked: opts.lock ?? true }] }),
    ),
  } as unknown as PrismaService;
  const startInstance = vi.fn(async () => ({}));
  const svc = new WorkflowReconcilerService(prisma, { startInstance } as unknown as WorkflowService);
  (svc as unknown as { client: unknown }).client = opts.connectFails
    ? async () => {
        throw new Error('ECONNREFUSED');
      }
    : async () => ({ workflow: { getHandle: () => ({ describe: opts.describe }) } });
  return { svc, updateMany, startInstance, findMany };
}

const status = (name: string) => async () => ({ status: { name } });

describe('WorkflowReconcilerService', () => {
  it('Failed + solicitud no EN_FIRMA -> FALLIDO con el estado real', async () => {
    const { svc, updateMany, startInstance } = setup({ describe: status('FAILED'), reqStatus: 'PENDIENTE' });
    await svc.reconcile();
    expect(startInstance).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FALLIDO', lastError: 'Temporal: FAILED' } }),
    );
  });

  it.each(['TIMED_OUT', 'TERMINATED', 'CANCELLED'])('%s -> FALLIDO', async (s) => {
    const { svc, updateMany } = setup({ describe: status(s), reqStatus: 'COMPLETADA' });
    await svc.reconcile();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FALLIDO', lastError: `Temporal: ${s}` } }),
    );
  });

  it('Running -> sin cambios', async () => {
    const { svc, updateMany, startInstance } = setup({ describe: status('RUNNING') });
    await svc.reconcile();
    expect(updateMany).not.toHaveBeenCalled();
    expect(startInstance).not.toHaveBeenCalled();
  });

  it('NotFound -> FALLIDO "no existe en Temporal"', async () => {
    const { svc, updateMany } = setup({
      describe: async () => {
        throw new WorkflowNotFoundError('nope', 'contrato:sr-1', undefined);
      },
      reqStatus: 'PENDIENTE',
    });
    await svc.reconcile();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FALLIDO', lastError: 'no existe en Temporal' } }),
    );
  });

  it('Temporal caído (describe falla) -> sin cambios', async () => {
    const { svc, updateMany } = setup({
      describe: async () => {
        throw new Error('UNAVAILABLE');
      },
    });
    await svc.reconcile();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('Temporal caído (conexión) -> sin cambios', async () => {
    const { svc, updateMany, startInstance } = setup({ describe: status('FAILED'), connectFails: true });
    await svc.reconcile();
    expect(updateMany).not.toHaveBeenCalled();
    expect(startInstance).not.toHaveBeenCalled();
  });

  it('EN_FIRMA + Failed -> reinicia una vez y deja la marca', async () => {
    const { svc, updateMany, startInstance } = setup({ describe: status('FAILED') });
    const r = await svc.reconcile();
    expect(r.restarted).toBe(1);
    expect(startInstance).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastError: 'restarted:1 (Temporal: FAILED)' } }),
    );
  });

  it('no reinicia dos veces: con la marca pasa a FALLIDO', async () => {
    const { svc, updateMany, startInstance } = setup({
      describe: status('FAILED'),
      lastError: 'restarted:1 (Temporal: FAILED)',
    });
    await svc.reconcile();
    expect(startInstance).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FALLIDO', lastError: 'Temporal: FAILED restarted:1' } }),
    );
  });

  it('tick: lock no obtenido -> omite', async () => {
    const { svc, findMany } = setup({ describe: status('FAILED'), lock: false });
    await svc.tick();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('tick: lock obtenido -> reconcilia', async () => {
    const { svc, findMany } = setup({ describe: status('RUNNING') });
    await svc.tick();
    expect(findMany).toHaveBeenCalled();
  });
});
