import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
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
  tenantId: string | null;
  payload: unknown;
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
          tenantId: r.tenantId ?? null,
          payload: r.payload ?? null,
        },
      ];
    }),
  );
  const claimSqls: string[] = [];
  const prisma = {
    // Simula UPDATE…FOR UPDATE SKIP LOCKED RETURNING: selecciona y aplica el lease de forma síncrona (atómica).
    $queryRaw: async (sql: { sql?: string; strings?: string[]; values?: unknown[] }) => {
      claimSqls.push(String(sql.sql ?? sql.strings?.join('?') ?? ''));
      const values = sql.values ?? [];
      const tenant = values.find((v) => typeof v === 'string') as string | undefined;
      const limit = values.filter((v) => typeof v === 'number').pop() as number | undefined;
      const now = Date.now();
      const claimed = [...rows.values()]
        .filter(
          (r) =>
            ['PENDIENTE', 'FALLIDO'].includes(r.status) &&
            r.nextAttemptAt.getTime() <= now &&
            (!tenant || r.tenantId === tenant),
        )
        .slice(0, limit ?? 25);
      for (const r of claimed) r.nextAttemptAt = new Date(now + 300_000);
      return claimed.map((r) => ({ ...r }));
    },
    notificationOutbox: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) =>
        [...rows.values()].filter(
          (r) =>
            (!where?.tenantId || r.tenantId === where.tenantId) &&
            (!where?.status || r.status === where.status),
        ),
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
        const r = rows.get(where.id);
        return r && r.tenantId === where.tenantId ? r : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `n${rows.size}`;
        const row = {
          id,
          status: 'PENDIENTE',
          attempts: 0,
          maxAttempts: 6,
          nextAttemptAt: new Date(0),
          sentAt: null,
          lastError: null,
          payload: null,
          ...data,
        } as unknown as Row;
        rows.set(id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rows.get(where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in (v as object)) {
            (r as unknown as Record<string, number>)[k] += (v as { increment: number }).increment;
          } else if (k === 'payload') {
            r.payload = null; // Prisma.DbNull
          } else {
            (r as unknown as Record<string, unknown>)[k] = v;
          }
        }
        return r;
      },
    },
  } as unknown as PrismaService;
  return { prisma, rows, claimSqls };
}

const okMailer = () => ({ enabled: true, send: vi.fn().mockResolvedValue('mid-1') }) as unknown as MailerService;

describe('NotificationOutboxService', () => {
  beforeAll(() => {
    process.env.STORAGE_MASTER_KEY = randomBytes(32).toString('base64');
  });
  beforeEach(() => vi.clearAllMocks());

  it('dispatchDue marca ENVIADO cuando el mailer responde', async () => {
    const { prisma, rows } = fakePrisma([{ id: 'a', status: 'PENDIENTE' }]);
    const svc = new NotificationOutboxService(prisma, okMailer());

    const res = await svc.dispatchDue();
    expect(res).toMatchObject({ sent: 1, failed: 0, dead: 0 });
    expect(rows.get('a')?.status).toBe('ENVIADO');
    expect(rows.get('a')?.sentAt).toBeInstanceOf(Date);
  });

  it('reintenta con backoff y cae a DLQ al alcanzar maxAttempts', async () => {
    const { prisma, rows } = fakePrisma([{ id: 'a', status: 'FALLIDO', attempts: 5, maxAttempts: 6 }]);
    const mailer = {
      enabled: true,
      send: vi.fn().mockRejectedValue(new Error('smtp caído')),
    } as unknown as MailerService;
    const res = await new NotificationOutboxService(prisma, mailer).dispatchDue();
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
    await new NotificationOutboxService(prisma, mailer).dispatchDue();
    expect(rows.get('a')?.status).toBe('FALLIDO');
    expect(rows.get('a')?.attempts).toBe(1);
    expect(rows.get('a')?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('no hace nada si SMTP no está configurado', async () => {
    const { prisma } = fakePrisma([{ id: 'a' }]);
    const mailer = { enabled: false, send: vi.fn() } as unknown as MailerService;
    const res = await new NotificationOutboxService(prisma, mailer).dispatchDue();
    expect(res).toMatchObject({ skipped: true });
    expect(mailer.send as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('el claim usa UPDATE…FOR UPDATE SKIP LOCKED RETURNING', async () => {
    const { prisma, claimSqls } = fakePrisma([{ id: 'a' }]);
    await new NotificationOutboxService(prisma, okMailer()).dispatchDue();
    expect(claimSqls[0]).toMatch(/UPDATE "NotificationOutbox"/);
    expect(claimSqls[0]).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(claimSqls[0]).toMatch(/RETURNING/);
  });

  it('dos dispatchers concurrentes no envían el mismo mensaje dos veces', async () => {
    const { prisma, rows } = fakePrisma([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const send = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'm';
    });
    const mailer = { enabled: true, send } as unknown as MailerService;
    const d1 = new NotificationOutboxService(prisma, mailer);
    const d2 = new NotificationOutboxService(prisma, mailer);
    const [r1, r2] = await Promise.all([d1.dispatchDue(2), d2.dispatchDue(2)]);
    expect(r1.sent + r2.sent).toBe(3);
    expect(send).toHaveBeenCalledTimes(3);
    expect([...rows.values()].every((r) => r.status === 'ENVIADO')).toBe(true);
  });

  it('un mensaje en lease (reclamado) no lo vuelve a ver otro dispatcher', async () => {
    const { prisma } = fakePrisma([{ id: 'a' }]);
    const hang = { enabled: true, send: vi.fn().mockImplementation(() => new Promise(() => {})) } as unknown as MailerService;
    void new NotificationOutboxService(prisma, hang).dispatchDue();
    await new Promise((r) => setTimeout(r, 1));
    const ok = okMailer();
    const r2 = await new NotificationOutboxService(prisma, ok).dispatchDue();
    expect(r2.sent).toBe(0);
    expect(ok.send).not.toHaveBeenCalled();
  });

  it('enqueue guarda tenantId y el enlace cifrado; el body no contiene el token', async () => {
    const { prisma, rows } = fakePrisma();
    const mailer = okMailer();
    const svc = new NotificationOutboxService(prisma, mailer);
    const token = 'TOKEN-SECRETO-123';
    const link = `http://x/firmar/${token}`;
    await svc.enqueueEmail({ to: 'a@b.c', subject: 's', html: '<a href="{{LINK}}">go</a>', tenantId: 't1', link });
    const row = [...rows.values()][0];
    expect(row.tenantId).toBe('t1');
    expect(row.body).not.toContain(token);
    expect(JSON.stringify(row.payload)).not.toContain(token);

    await svc.dispatchDue();
    const sent = (mailer.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.html).toBe(`<a href="${link}">go</a>`);
    expect(row.status).toBe('ENVIADO');
    expect(row.payload).toBeNull(); // enlace cifrado purgado tras enviar
  });

  it('con {{LINK}} sin enlace cifrado no envía el marcador (queda para reintento)', async () => {
    const { prisma, rows } = fakePrisma([{ id: 'a', body: 'x {{LINK}}' }]);
    const mailer = okMailer();
    await new NotificationOutboxService(prisma, mailer).dispatchDue();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(rows.get('a')?.status).toBe('FALLIDO');
  });

  it('list/retry/dispatch se acotan al tenant; retry de otro tenant da 404', async () => {
    const { prisma, rows } = fakePrisma([
      { id: 'a', tenantId: 't1', status: 'DLQ' },
      { id: 'b', tenantId: 't2', status: 'DLQ' },
    ]);
    const svc = new NotificationOutboxService(prisma, okMailer());
    expect((await svc.list({ tenantId: 't1' })).map((r) => r.id)).toEqual(['a']);
    await expect(svc.retry('b', 't1')).rejects.toBeInstanceOf(NotFoundException);
    await svc.retry('a', 't1');
    expect(rows.get('a')?.status).toBe('PENDIENTE');
    const res = await svc.dispatchDue(25, 't1');
    expect(res.sent).toBe(1);
    expect(rows.get('b')?.status).toBe('DLQ');
  });
});
