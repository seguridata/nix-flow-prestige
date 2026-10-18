import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CollaborationService } from './collaboration.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditChainService } from './audit-chain.service';

type Row = Record<string, unknown>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    return row[k] === v;
  });
}

function table(rows: Row[]) {
  return {
    findFirst: vi.fn(async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => rows.filter((r) => matches(r, where))),
    create: vi.fn(async ({ data }: { data: Row }) => ({ id: 'new', ...data })),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    upsert: vi.fn(async (a: { create: Row }) => a.create),
  };
}

function setup() {
  const prisma = {
    document: table([{ id: 'docA', tenantId: 'A' }, { id: 'docB', tenantId: 'B' }]),
    signatureRequest: table([{ id: 'srA', tenantId: 'A' }, { id: 'srB', tenantId: 'B' }]),
    onboardingCase: table([{ id: 'obA', tenantId: 'A' }, { id: 'obB', tenantId: 'B' }]),
    documentComment: table([
      { id: 'c1', documentId: 'docA', tenantId: 'A', body: 'x' },
      { id: 'c2', documentId: 'docB', tenantId: 'B', body: 'y' },
    ]),
    userNotification: table([
      { id: 'n1', userId: 'maria', tenantId: 'A', read: false },
      { id: 'n2', userId: 'carlos', tenantId: 'A', read: false },
      { id: 'n3', userId: 'maria', tenantId: 'B', read: false },
    ]),
    processWatcher: table([{ signatureRequestId: 'srA', userId: 'maria', tenantId: 'A' }]),
    processAuditEvent: table([
      { id: 'e1', signatureRequestId: 'srA', tenantId: 'A' },
      { id: 'e2', signatureRequestId: 'srB', tenantId: 'B' },
    ]),
  };
  const svc = new CollaborationService(
    prisma as unknown as PrismaService,
    { append: vi.fn() } as unknown as AuditChainService,
  );
  return { prisma, svc };
}

describe('CollaborationService - aislamiento por tenant', () => {
  it('comentarios: documento de otro tenant -> 404 y no se lista', async () => {
    const { svc } = setup();
    await expect(svc.listComments('docB', 'A')).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.listComments('docA', 'A')).map((c) => c.id)).toEqual(['c1']);
  });

  it('addComment: 404 cross-tenant y guarda tenantId en el registro nuevo', async () => {
    const { svc, prisma } = setup();
    await expect(
      svc.addComment({ documentId: 'docB', authorId: 'u', authorName: 'U', body: 'hi', tenantId: 'A' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.documentComment.create).not.toHaveBeenCalled();
    await svc.addComment({ documentId: 'docA', authorId: 'u', authorName: 'U', body: 'hi', tenantId: 'A' });
    expect(prisma.documentComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 'A', documentId: 'docA' }),
    });
  });

  it('notificaciones: solo las del userId+tenant', async () => {
    const { svc } = setup();
    expect((await svc.listNotifications('maria', 'A')).map((n) => n.id)).toEqual(['n1']);
  });

  it('markRead: de otro usuario o tenant -> 404', async () => {
    const { svc } = setup();
    await expect(svc.markRead('n2', 'maria', 'A')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.markRead('n3', 'maria', 'A')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.markRead('n1', 'maria', 'A')).resolves.toEqual({ ok: true });
  });

  it('watchers: GET/POST sobre solicitud ajena -> 404; alta guarda tenantId', async () => {
    const { svc, prisma } = setup();
    await expect(svc.listWatchers('srB', 'A')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.addWatcher('srB', 'maria', 'A')).rejects.toBeInstanceOf(NotFoundException);
    await svc.addWatcher('srA', 'maria', 'A', 'Maria');
    expect(prisma.processWatcher.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ tenantId: 'A' }) }),
    );
  });

  it('listAudit: recurso ajeno -> 404; propio -> solo eventos del tenant', async () => {
    const { svc } = setup();
    await expect(svc.listAudit({ signatureRequestId: 'srB' }, 'A')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.listAudit({ documentId: 'docB' }, 'A')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.listAudit({ onboardingId: 'obB' }, 'A')).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.listAudit({ signatureRequestId: 'srA' }, 'A')).map((e) => e.id)).toEqual(['e1']);
    expect((await svc.listAudit({}, 'A')).map((e) => e.id)).toEqual(['e1']);
  });
});
