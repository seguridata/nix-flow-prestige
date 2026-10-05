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
  subscription: {
    id: string;
    url: string;
    secret: string;
    tenantId: string;
    previousSecret: string | null;
    previousSecretUntil: Date | null;
  };
}

function fakePrisma(rows: Partial<Delivery>[], sub: Partial<Delivery['subscription']> = {}) {
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
            previousSecret: null,
            previousSecretUntil: null,
            ...sub,
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
    webhookSubscription: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        for (const d of store.values()) Object.assign(d.subscription, data);
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

describe('rotación de secreto de webhook', () => {
  afterEach(() => vi.unstubAllGlobals());

  const capture = () => {
    const seen = { headers: {} as Record<string, string>, body: '' };
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      seen.headers = Object.fromEntries(new Headers(init.headers).entries());
      seen.body = String(init.body);
      return new Response('ok', { status: 200 });
    });
    return seen;
  };

  it('rotateSecret guarda el anterior con ventana y devuelve el nuevo una vez', async () => {
    const update = vi.fn(async (_a: { data: Record<string, unknown> }) => ({}));
    const prisma = {
      webhookSubscription: {
        findUnique: async () => ({ id: 's1', tenantId: 't1', secret: 'old-secret' }),
        update,
      },
    } as unknown as PrismaService;
    const before = Date.now();
    const res = await new WebhooksService(prisma).rotateSecret('t1', 's1');
    const arg = update.mock.calls[0][0].data;
    expect(arg.previousSecret).toBe('old-secret');
    expect(arg.secret).toBe(res.secret);
    expect(res.secret).not.toBe('old-secret');
    const until = (arg.previousSecretUntil as Date).getTime();
    expect(until).toBeGreaterThanOrEqual(before + 24 * 3_600_000 - 1000);
  });

  it('dentro de la ventana la entrega lleva ambas firmas', async () => {
    const { prisma } = fakePrisma([{ id: 'd1' }], {
      secret: 'new',
      previousSecret: 'old',
      previousSecretUntil: new Date(Date.now() + 60_000),
    });
    const seen = capture();
    await new WebhooksService(prisma, async () => ['93.184.216.34']).dispatchDue();
    const ts = seen.headers['x-prestige-timestamp'];
    expect(seen.headers['x-prestige-signature']).toBe(`sha256=${signPayload('new', ts, seen.body)}`);
    expect(seen.headers['x-prestige-signature-previous']).toBe(`sha256=${signPayload('old', ts, seen.body)}`);
  });

  it('fuera de la ventana solo firma el actual y limpia el anterior', async () => {
    const { prisma, store } = fakePrisma([{ id: 'd1' }], {
      secret: 'new',
      previousSecret: 'old',
      previousSecretUntil: new Date(Date.now() - 60_000),
    });
    const seen = capture();
    await new WebhooksService(prisma, async () => ['93.184.216.34']).dispatchDue();
    expect(seen.headers['x-prestige-signature']).toBeDefined();
    expect(seen.headers['x-prestige-signature-previous']).toBeUndefined();
    expect(store.get('d1')?.subscription.previousSecret).toBeNull();
  });

  it('list y update no filtran secretos (ni el anterior)', async () => {
    const row = {
      id: 's1',
      tenantId: 't1',
      url: 'https://example.test/h',
      secret: 'current-secret-1234',
      previousSecret: 'old-secret-9999',
      previousSecretUntil: new Date(Date.now() + 60_000),
      events: ['*'],
      active: true,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prisma = {
      webhookSubscription: {
        findMany: async () => [row],
        findUnique: async () => row,
        update: async () => row,
      },
    } as unknown as PrismaService;
    const svc = new WebhooksService(prisma, async () => ['93.184.216.34']);
    const listed = JSON.stringify(await svc.list('t1'));
    const updated = JSON.stringify(await svc.update('t1', 's1', { active: true }));
    for (const out of [listed, updated]) {
      expect(out).not.toContain('current-secret-1234');
      expect(out).not.toContain('old-secret-9999');
      expect(out).not.toContain('previousSecret');
    }
  });
});
