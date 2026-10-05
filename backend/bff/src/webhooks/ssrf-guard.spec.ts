import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UnsafeWebhookUrlError, assertSafeWebhookUrl, isPrivateAddress } from './ssrf-guard';
import { WebhooksService, maskSecret } from './webhooks.service';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::a00:1',
  ])('%s es interna', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946'])(
    '%s es pública',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('assertSafeWebhookUrl', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const pub = async () => ['93.184.216.34'];

  it('acepta https público', async () => {
    await expect(assertSafeWebhookUrl('https://hooks.example.com/x', pub)).resolves.toBeInstanceOf(URL);
  });

  it('rechaza esquemas no http(s) y credenciales en la URL', async () => {
    await expect(assertSafeWebhookUrl('ftp://example.com', pub)).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    await expect(assertSafeWebhookUrl('https://u:p@example.com', pub)).rejects.toBeInstanceOf(
      UnsafeWebhookUrlError,
    );
  });

  it('rechaza IP literal de metadata y hosts que resuelven a IP interna', async () => {
    await expect(assertSafeWebhookUrl('http://169.254.169.254/latest/meta-data', pub)).rejects.toThrow(
      /interna/,
    );
    await expect(assertSafeWebhookUrl('https://evil.example.com', async () => ['10.0.0.5'])).rejects.toThrow(
      /interna/,
    );
    // Una sola dirección interna entre varias basta para rechazar (DNS multi-registro).
    await expect(
      assertSafeWebhookUrl('https://evil.example.com', async () => ['93.184.216.34', '127.0.0.1']),
    ).rejects.toThrow(/interna/);
  });

  it('en producción solo https', async () => {
    process.env.NODE_ENV = 'production';
    await expect(assertSafeWebhookUrl('http://example.com', pub)).rejects.toThrow(/https/);
    await expect(assertSafeWebhookUrl('https://example.com', pub)).resolves.toBeInstanceOf(URL);
  });

  it('WEBHOOK_ALLOW_PRIVATE solo aplica fuera de producción', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    process.env.NODE_ENV = 'development';
    await expect(assertSafeWebhookUrl('http://127.0.0.1:9000/h', pub)).resolves.toBeInstanceOf(URL);
    process.env.NODE_ENV = 'production';
    await expect(assertSafeWebhookUrl('https://127.0.0.1/h', pub)).rejects.toThrow(/interna/);
  });
});

describe('WebhooksService — SSRF, secreto y filtro active', () => {
  afterEach(() => vi.unstubAllGlobals());

  const base = (over: Record<string, unknown> = {}) => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', ...data }));
    const deliveryFindMany = vi.fn(async () => []);
    const prisma = {
      webhookSubscription: {
        create,
        findMany: async () => [{ id: 's1', tenantId: 't', url: 'https://x.test', secret: 'abcdefghijkl' }],
      },
      webhookDelivery: { findMany: deliveryFindMany },
      ...over,
    };
    return { svc: new WebhooksService(prisma as never, async () => ['93.184.216.34']), create, deliveryFindMany };
  };

  it('create rechaza URLs internas con 400 y no persiste', async () => {
    const { svc, create } = base();
    await expect(svc.create('t', { url: 'https://169.254.169.254/' })).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('create devuelve el secreto; list lo enmascara', async () => {
    const { svc } = base();
    const created = (await svc.create('t', { url: 'https://hooks.example.com' })) as { secret: string };
    expect(created.secret.length).toBeGreaterThan(8);
    const [row] = await svc.list('t');
    expect(row.secret).toBe(maskSecret('abcdefghijkl'));
    expect(row.secret).not.toContain('abcdefgh');
  });

  it('dispatchDue filtra suscripciones activas', async () => {
    const { svc, deliveryFindMany } = base();
    await svc.dispatchDue();
    expect(deliveryFindMany.mock.calls[0]![0]).toMatchObject({ where: { subscription: { active: true } } });
  });

  it('el despacho usa redirect: manual y trata un 302 como fallo', async () => {
    let seenRedirect: string | undefined;
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      seenRedirect = init.redirect;
      return new Response(null, { status: 302 });
    });
    const update = vi.fn(async () => ({}));
    const prisma = {
      webhookDelivery: {
        findMany: async () => [
          {
            id: 'd1',
            eventType: 'e',
            payload: {},
            attempts: 0,
            maxAttempts: 8,
            subscription: { url: 'https://hooks.example.com', secret: 's' },
          },
        ],
        update,
      },
    };
    const svc = new WebhooksService(prisma as never, async () => ['93.184.216.34']);
    const res = await svc.dispatchDue();
    expect(seenRedirect).toBe('manual');
    expect(res).toMatchObject({ sent: 0, failed: 1 });
  });

  it('el despacho no llama fetch si la URL ahora resuelve a una IP interna', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const prisma = {
      webhookDelivery: {
        findMany: async () => [
          {
            id: 'd1',
            eventType: 'e',
            payload: {},
            attempts: 0,
            maxAttempts: 8,
            subscription: { url: 'https://rebind.example.com', secret: 's' },
          },
        ],
        update: async () => ({}),
      },
    };
    const svc = new WebhooksService(prisma as never, async () => ['10.0.0.1']);
    await svc.dispatchDue();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
