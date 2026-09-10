import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CloudEvent } from './cloud-events';

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

  constructor(private readonly prisma: PrismaService) {}

  // ---- Suscripciones (CRUD, ámbito admin del tenant) ----

  create(tenantId: string, body: { url: string; events?: string[]; description?: string; secret?: string }) {
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

  list(tenantId: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    tenantId: string,
    id: string,
    body: { url?: string; events?: string[]; active?: boolean; description?: string },
  ) {
    await this.getOwned(tenantId, id);
    return this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        url: body.url,
        events: body.events,
        active: body.active,
        description: body.description,
      },
    });
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
      where: { status: { in: ['PENDIENTE', 'FALLIDO'] }, nextAttemptAt: { lte: new Date() } },
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
      let responseStatus: number | undefined;
      try {
        const res = await fetch(row.subscription.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Prestige-Webhooks/1.0',
            'x-prestige-event': row.eventType,
            'x-prestige-delivery': row.id,
            'x-prestige-timestamp': timestamp,
            'x-prestige-signature': `sha256=${signature}`,
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
