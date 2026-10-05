import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STABLE_ORDER, finishPage, mapPage, pageArgs, prismaPage, type PageQueryDto } from '../common/pagination';
import type { CloudEvent } from './cloud-events';
import {
  UnsafeWebhookUrlError,
  assertSafeWebhookUrl,
  defaultResolver,
  type HostResolver,
} from './ssrf-guard';

/** Enmascara el secreto para listados: solo los últimos 4 caracteres. */
export function maskSecret(secret: string): string {
  return `••••${secret.slice(-4)}`;
}

/** Ventana (ms) en que el secreto anterior sigue firmando tras una rotación. */
function rotationWindowMs(): number {
  const hours = Number(process.env.WEBHOOK_SECRET_ROTATION_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3_600_000;
}

/** Quita los secretos anteriores (nunca salen por API) y enmascara el actual. */
function toPublic<T extends { secret: string; previousSecret?: string | null; previousSecretUntil?: Date | null }>(
  row: T,
) {
  const { previousSecret: _ps, previousSecretUntil: _pu, ...rest } = row;
  return { ...rest, secret: maskSecret(row.secret) };
}

/** Backoff exponencial acotado a 15 min (attempt empieza en 1: 1,2,4,8,15,15…). */
function backoffMs(attempt: number): number {
  return Math.min(2 ** (attempt - 1), 15) * 60_000;
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Verificación para tests / consumidores de referencia. */
export function verifySignature(
  secret: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
): boolean {
  const expected = signPayload(secret, timestamp, body);
  const got = signatureHeader.replace(/^sha256=/, '');
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolveHost: HostResolver = defaultResolver,
  ) {}

  private async assertUrl(url: string) {
    try {
      await assertSafeWebhookUrl(url, this.resolveHost);
    } catch (error) {
      if (error instanceof UnsafeWebhookUrlError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  // ---- Suscripciones (CRUD, ámbito admin del tenant) ----

  /**
   * Devuelve la suscripción CON el secreto completo: es la única vez que se
   * ve (create y rotateSecret). `list`/`update` lo enmascaran.
   */
  async create(
    tenantId: string,
    body: { url: string; events?: string[]; description?: string; secret?: string },
  ) {
    await this.assertUrl(body.url);
    return this.prisma.webhookSubscription.create({
      data: {
        tenantId,
        url: body.url,
        secret: body.secret?.trim() || randomBytes(24).toString('base64url'),
        events: body.events?.length ? body.events : ['*'],
        description: body.description,
      },
    });
  }

  async list(tenantId: string, page?: PageQueryDto) {
    const args = pageArgs(page);
    const rows = await this.prisma.webhookSubscription.findMany({
      where: { tenantId },
      orderBy: STABLE_ORDER,
      ...prismaPage(args),
    });
    return mapPage(finishPage(rows, args), (r) => toPublic(r));
  }

  /**
   * Genera un secreto nuevo y lo devuelve UNA vez. El actual pasa a
   * `previousSecret` con validez `WEBHOOK_SECRET_ROTATION_HOURS` (24 h por
   * defecto): durante esa ventana cada entrega lleva además la cabecera
   * `x-prestige-signature-previous` para que el receptor migre sin cortes.
   */
  async rotateSecret(tenantId: string, id: string) {
    const sub = await this.getOwned(tenantId, id);
    const secret = randomBytes(24).toString('base64url');
    const previousSecretUntil = new Date(Date.now() + rotationWindowMs());
    await this.prisma.webhookSubscription.update({
      where: { id },
      data: { secret, previousSecret: sub.secret, previousSecretUntil },
    });
    return { id, secret, previousSecretValidUntil: previousSecretUntil.toISOString() };
  }

  async update(
    tenantId: string,
    id: string,
    body: { url?: string; events?: string[]; active?: boolean; description?: string },
  ) {
    await this.getOwned(tenantId, id);
    if (body.url) await this.assertUrl(body.url);
    const row = await this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        url: body.url,
        events: body.events,
        active: body.active,
        description: body.description,
      },
    });
    return toPublic(row);
  }

  async remove(tenantId: string, id: string) {
    await this.getOwned(tenantId, id);
    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { ok: true };
  }

  private async getOwned(tenantId: string, id: string) {
    const sub = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!sub || sub.tenantId !== tenantId) throw new NotFoundException(`Suscripción ${id} no encontrada`);
    return sub;
  }

  // ---- Emisión ----

  /**
   * Encola una entrega por cada suscripción activa del tenant que matchee el
   * tipo de evento. Idempotente por (subscriptionId, eventId): reintentar
   * `emit` con el mismo `event.id` no duplica entregas.
   */
  async emit(event: CloudEvent) {
    const subs = await this.prisma.webhookSubscription.findMany({
      where: { tenantId: event.tenantid, active: true },
    });
    const targets = subs.filter((s) => s.events.includes('*') || s.events.includes(event.type));
    if (targets.length === 0) return { queued: 0 };

    let queued = 0;
    for (const sub of targets) {
      try {
        await this.prisma.webhookDelivery.create({
          data: {
            subscriptionId: sub.id,
            eventType: event.type,
            eventId: event.id,
            payload: event as unknown as Prisma.InputJsonValue,
          },
        });
        queued += 1;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
    return { queued };
  }

  // ---- Despacho ----

  async dispatchDue(limit = 20) {
    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        status: { in: ['PENDIENTE', 'FALLIDO'] },
        nextAttemptAt: { lte: new Date() },
        // Una suscripción desactivada no recibe entregas (ni las ya encoladas).
        subscription: { active: true },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      include: { subscription: true },
    });

    let sent = 0;
    let failed = 0;
    let dead = 0;

    for (const row of due) {
      const body = JSON.stringify(row.payload);
      const timestamp = String(Date.now());
      const signature = signPayload(row.subscription.secret, timestamp, body);
      const sub = row.subscription;
      const prevActive =
        !!sub.previousSecret && !!sub.previousSecretUntil && sub.previousSecretUntil.getTime() > Date.now();
      if (sub.previousSecret && !prevActive) {
        // Ventana vencida: limpieza oportunista (best-effort).
        await this.prisma.webhookSubscription
          .update({ where: { id: sub.id }, data: { previousSecret: null, previousSecretUntil: null } })
          .catch(() => undefined);
      }
      const prevSignature = prevActive ? signPayload(sub.previousSecret!, timestamp, body) : undefined;
      let responseStatus: number | undefined;
      try {
        // SSRF: se revalida en cada despacho (el DNS pudo cambiar) y NO se
        // siguen redirecciones (un 302 a una IP interna saltaría la validación).
        await assertSafeWebhookUrl(row.subscription.url, this.resolveHost);
        const res = await fetch(row.subscription.url, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Prestige-Webhooks/1.0',
            'x-prestige-event': row.eventType,
            'x-prestige-delivery': row.id,
            'x-prestige-timestamp': timestamp,
            'x-prestige-signature': `sha256=${signature}`,
            ...(prevSignature ? { 'x-prestige-signature-previous': `sha256=${prevSignature}` } : {}),
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        responseStatus = res.status;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await this.prisma.webhookDelivery.update({
          where: { id: row.id },
          data: {
            status: 'ENVIADO',
            deliveredAt: new Date(),
            responseStatus,
            lastError: null,
            attempts: { increment: 1 },
          },
        });
        sent += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        const toDlq = attempts >= row.maxAttempts;
        await this.prisma.webhookDelivery.update({
          where: { id: row.id },
          data: {
            status: toDlq ? 'DLQ' : 'FALLIDO',
            attempts,
            responseStatus,
            lastError: message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
          },
        });
        if (toDlq) {
          dead += 1;
          this.log.error(`Webhook ${row.id} → DLQ tras ${attempts} intentos: ${message}`);
        } else {
          failed += 1;
        }
      }
    }
    if (sent || failed || dead) this.log.log(`Webhooks: ${sent} entregados, ${failed} reintentables, ${dead} a DLQ`);
    return { sent, failed, dead };
  }

  listDeliveries(tenantId: string, params: { status?: string; take?: number }) {
    return this.prisma.webhookDelivery.findMany({
      where: {
        subscription: { tenantId },
        status: params.status ? (params.status as never) : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.take ?? 100, 500),
      include: { subscription: { select: { url: true, description: true } } },
    });
  }

  async retryDelivery(tenantId: string, id: string) {
    const row = await this.prisma.webhookDelivery.findUnique({
      where: { id },
      include: { subscription: true },
    });
    if (!row || row.subscription.tenantId !== tenantId) {
      throw new NotFoundException(`Entrega ${id} no encontrada`);
    }
    return this.prisma.webhookDelivery.update({
      where: { id },
      data: { status: 'PENDIENTE', nextAttemptAt: new Date(), lastError: null },
    });
  }

  /** Dispara un evento de prueba contra una suscripción. */
  async ping(tenantId: string, id: string) {
    const sub = await this.getOwned(tenantId, id);
    const event = {
      specversion: '1.0' as const,
      id: randomBytes(8).toString('hex'),
      source: '/prestige/bff',
      type: 'mx.seguridata.prestige.webhook.ping',
      time: new Date().toISOString(),
      datacontenttype: 'application/json' as const,
      tenantid: tenantId,
      data: { subscriptionId: sub.id, message: 'ping' },
    };
    await this.prisma.webhookDelivery.create({
      data: {
        subscriptionId: sub.id,
        eventType: event.type,
        eventId: event.id,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
    return { ok: true, eventId: event.id };
  }
}
