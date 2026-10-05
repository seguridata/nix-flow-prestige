import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhooksService, signPayload, verifySignature } from './webhooks.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('firma HMAC de webhooks', () => {
  it('signPayload/verifySignature son consistentes y rechazan alteraciones', () => {
    const secret = 's3cr3t';
    const ts = '1700000000000';
    const body = JSON.stringify({ type: 'x', data: { a: 1 } });
    const sig = signPayload(secret, ts, body);

    expect(verifySignature(secret, ts, body, `sha256=${sig}`)).toBe(true);
    expect(verifySignature(secret, ts, body, sig)).toBe(true); // sin prefijo
    expect(verifySignature(secret, ts, body + ' ', `sha256=${sig}`)).toBe(false);
    expect(verifySignature('otro', ts, body, `sha256=${sig}`)).toBe(false);
    expect(verifySignature(secret, '1700000000001', body, `sha256=${sig}`)).toBe(false);
  });
});

interface Delivery {
  id: string;
  subscriptionId: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  responseStatus: number | null;
  nextAttemptAt: Date;
  deliveredAt: Date | null;
  subscription: { id: string; url: string; secret: string; tenantId: string };
}

function fakePrisma(rows: Partial<Delivery>[]) {
  const store = new Map<string, Delivery>(
    rows.map((r, i) => {
      const id = r.id ?? `d${i}`;
      return [
        id,
        {
          id,
          subscriptionId: 'sub-1',
          eventType: r.eventType ?? 'mx.seguridata.prestige.request.completed',
          eventId: r.eventId ?? `e${i}`,
          payload: r.payload ?? { hello: 'world' },
          status: r.status ?? 'PENDIENTE',
          attempts: r.attempts ?? 0,
          maxAttempts: r.maxAttempts ?? 8,
          lastError: null,
          responseStatus: null,
          nextAttemptAt: r.nextAttemptAt ?? new Date(0),
          deliveredAt: null,
          subscription: {
            id: 'sub-1',
            url: 'https://example.test/hook',
            secret: 'shh',
            tenantId: 'seguridata',
          },
        },
      ];
    }),
  );
  const prisma = {
    webhookDelivery: {
      findMany: async () => [...store.values()].filter((d) => ['PENDIENTE', 'FALLIDO'].includes(d.status)),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const d = store.get(where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in (v as object)) {
            (d as Record<string, number>)[k] += (v as { increment: number }).increment;
          } else {
            (d as Record<string, unknown>)[k] = v;
          }
        }
        return d;
      },
    },
  } as unknown as PrismaService;
  return { prisma, store };
}

describe('WebhooksService.dispatchDue', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('entrega y marca ENVIADO con la cabecera de firma correcta', async () => {
    const { prisma, store } = fakePrisma([{ id: 'd1' }]);
    const seen: { url: string; headers: Record<string, string>; body: string } = {
      url: '',
      headers: {},
      body: '',
    };
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.headers = Object.fromEntries(new Headers(init.headers).entries());
      seen.body = String(init.body);
      return new Response('ok', { status: 200 });
    });

    const svc = new WebhooksService(prisma, async () => ['93.184.216.34']);
    const res = await svc.dispatchDue();

    expect(res).toMatchObject({ sent: 1, dead: 0 });
    expect(store.get('d1')?.status).toBe('ENVIADO');
    expect(seen.url).toBe('https://example.test/hook');
    const ts = seen.headers['x-prestige-timestamp'];
    expect(seen.headers['x-prestige-signature']).toBe(`sha256=${signPayload('shh', ts, seen.body)}`);
    expect(seen.headers['x-prestige-event']).toContain('request.completed');
  });

  it('un 500 reintenta (FALLIDO) y agota a DLQ en el último intento', async () => {
    const { prisma, store } = fakePrisma([{ id: 'd1', attempts: 7, maxAttempts: 8 }]);
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }));

    const svc = new WebhooksService(prisma, async () => ['93.184.216.34']);
    const res = await svc.dispatchDue();

    expect(res).toMatchObject({ sent: 0, dead: 1 });
    expect(store.get('d1')?.status).toBe('DLQ');
    expect(store.get('d1')?.attempts).toBe(8);
    expect(store.get('d1')?.lastError).toContain('HTTP 500');
  });
});
