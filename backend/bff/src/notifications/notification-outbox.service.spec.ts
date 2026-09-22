import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationOutboxService } from './notification-outbox.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MailerService } from './mailer.service';

interface Row {
  id: string;
  toAddress: string;
  subject: string;
  body: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
  sentAt: Date | null;
  dedupeKey: string | null;
}

function fakePrisma(seed: Partial<Row>[] = []) {
  const rows = new Map<string, Row>(
    seed.map((r, i) => {
      const id = r.id ?? `o${i}`;
      return [
        id,
        {
          id,
          toAddress: r.toAddress ?? 'x@y.z',
          subject: r.subject ?? 's',
          body: r.body ?? 'b',
          status: r.status ?? 'PENDIENTE',
          attempts: r.attempts ?? 0,
          maxAttempts: r.maxAttempts ?? 6,
          lastError: r.lastError ?? null,
          nextAttemptAt: r.nextAttemptAt ?? new Date(0),
          sentAt: r.sentAt ?? null,
          dedupeKey: r.dedupeKey ?? null,
        },
      ];
    }),
  );
  const prisma = {
    notificationOutbox: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        const st = (where?.status as { in?: string[] })?.in;
        const now = Date.now();
        return [...rows.values()].filter(
          (r) =>
            (!st || st.includes(r.status)) &&
            (!where?.nextAttemptAt || r.nextAttemptAt.getTime() <= now),
        );
      },
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rows.get(where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in (v as object)) {
            (r as Record<string, number>)[k] += (v as { increment: number }).increment;
          } else {
            (r as Record<string, unknown>)[k] = v;
          }
        }
        return r;
      },
    },
  } as unknown as PrismaService;
  return { prisma, rows };
}

describe('NotificationOutboxService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatchDue marca ENVIADO cuando el mailer responde', async () => {
    const { prisma, rows } = fakePrisma([{ id: 'a', status: 'PENDIENTE' }]);
    const mailer = { enabled: true, send: vi.fn().mockResolvedValue('mid-1') } as unknown as MailerService;
    const svc = new NotificationOutboxService(prisma, mailer);

    const res = await svc.dispatchDue();
    expect(res).toMatchObject({ sent: 1, failed: 0, dead: 0 });
    expect(rows.get('a')?.status).toBe('ENVIADO');
    expect(rows.get('a')?.sentAt).toBeInstanceOf(Date);
  });

  it('reintenta con backoff y cae a DLQ al alcanzar maxAttempts', async () => {
    const { prisma, rows } = fakePrisma([
      { id: 'a', status: 'FALLIDO', attempts: 5, maxAttempts: 6 },
    ]);
    const mailer = {
      enabled: true,
      send: vi.fn().mockRejectedValue(new Error('smtp caído')),
    } as unknown as MailerService;
    const svc = new NotificationOutboxService(prisma, mailer);

    const res = await svc.dispatchDue();
    expect(res).toMatchObject({ sent: 0, dead: 1 });
    expect(rows.get('a')?.status).toBe('DLQ');
    expect(rows.get('a')?.attempts).toBe(6);
    expect(rows.get('a')?.lastError).toContain('smtp caído');
  });

  it('un fallo por debajo de maxAttempts deja el mensaje FALLIDO y reprograma', async () => {
    const { prisma, rows } = fakePrisma([{ id: 'a', status: 'PENDIENTE', attempts: 0 }]);
    const mailer = {
      enabled: true,
      send: vi.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as MailerService;
    const svc = new NotificationOutboxService(prisma, mailer);

    await svc.dispatchDue();
    expect(rows.get('a')?.status).toBe('FALLIDO');
    expect(rows.get('a')?.attempts).toBe(1);
    expect(rows.get('a')?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('no hace nada si SMTP no está configurado', async () => {
    const { prisma } = fakePrisma([{ id: 'a' }]);
    const mailer = { enabled: false, send: vi.fn() } as unknown as MailerService;
    const svc = new NotificationOutboxService(prisma, mailer);
    const res = await svc.dispatchDue();
    expect(res).toMatchObject({ skipped: true });
    expect((mailer.send as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
