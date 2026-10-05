/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { AuditChainService, VERIFY_MAX_EVENTS } from './audit-chain.service';

function fake(tenantOfRequest?: string) {
  const created: any[] = [];
  const tx: any = {
    $queryRaw: async () => [{ seq: 0n, hash: '' }],
    $executeRaw: async () => 1,
    signatureRequest: { findUnique: vi.fn(async () => (tenantOfRequest ? { tenantId: tenantOfRequest } : null)) },
    processAuditEvent: {
      create: async ({ data }: any) => {
        created.push(data);
        return data;
      },
    },
  };
  tx.$transaction = async (fn: any) => fn(tx);
  return { tx, created };
}

describe('AuditChainService - tenant', () => {
  it('append guarda el tenantId explicito', async () => {
    const { tx, created } = fake();
    await new AuditChainService(tx).append({ actorId: 'a', action: 'X', tenantId: 'A' });
    expect(created[0].tenantId).toBe('A');
  });

  it('append deriva el tenant de la solicitud si no se pasa', async () => {
    const { tx, created } = fake('B');
    await new AuditChainService(tx).append({ actorId: 'a', action: 'X', signatureRequestId: 'r1' });
    expect(created[0].tenantId).toBe('B');
  });

  it('el hash no depende del tenantId (no rompe eventos previos)', async () => {
    const a = fake();
    const b = fake();
    const frozen = new Date('2026-01-01T00:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(frozen);
    await new AuditChainService(a.tx).append({ actorId: 'a', action: 'X', tenantId: 'A' });
    await new AuditChainService(b.tx).append({ actorId: 'a', action: 'X', tenantId: 'B' });
    vi.useRealTimers();
    expect(a.created[0].hash).toBe(b.created[0].hash);
  });

  it('verify con tenantId filtra por tenant y aplica tope', async () => {
    const findMany = vi.fn(async () => []);
    const svc = new AuditChainService({ processAuditEvent: { findMany } } as any);
    const res = await svc.verify({ tenantId: 'A' });
    expect(res.mode).toBe('scoped');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'A' }),
        take: VERIFY_MAX_EVENTS + 1,
      }),
    );
  });
});
