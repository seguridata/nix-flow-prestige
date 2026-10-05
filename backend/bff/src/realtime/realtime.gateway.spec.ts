/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from './realtime.gateway';

function setup() {
  const prisma = {
    document: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.id === 'docA' && where.tenantId === 'A' ? { id: 'docA' } : null,
      ),
    },
  };
  const gw = new RealtimeGateway({ duplicate: () => null } as any, prisma as any);
  (gw as any).server = { to: () => ({ emit: vi.fn() }) };
  const mkClient = (id: string, tenantId: string) => {
    (gw as any).socketUsers.set(id, { actorId: id, tenantId });
    (gw as any).socketMemberships.set(id, new Map());
    return { id, join: vi.fn(), leave: vi.fn(), disconnect: vi.fn() } as any;
  };
  return { gw, mkClient };
}

describe('RealtimeGateway - tenant', () => {
  it('join-document de documento ajeno: no se une a la sala', async () => {
    const { gw, mkClient } = setup();
    const b = mkClient('b', 'B');
    const res = await gw.handleJoinDocument(b, { documentId: 'docA' });
    expect(b.join).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, error: 'not-found' });
  });

  it('join-document del propio tenant: se une', async () => {
    const { gw, mkClient } = setup();
    const a = mkClient('a', 'A');
    await gw.handleJoinDocument(a, { documentId: 'docA' });
    expect(a.join).toHaveBeenCalledWith('document:docA');
  });

  it('handshake invalido/sin tenant: desconecta y no registra usuario', async () => {
    const { gw } = setup();
    const client = { id: 'x', handshake: { auth: { token: 't' }, headers: {} }, disconnect: vi.fn() } as any;
    await gw.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect((gw as any).socketUsers.has('x')).toBe(false);
  });
});
