import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { withAdvisoryLock } from '../common/advisory-lock';
import { PrismaService } from '../prisma/prisma.service';
import { WebhooksService } from './webhooks.service';

/**
 * M14 — despacha las entregas de webhook vencidas cada 10 s (reintentos con
 * backoff exponencial; a DLQ tras `maxAttempts`).
 */
@Injectable()
export class WebhookDispatcher {
  private readonly log = new Logger(WebhookDispatcher.name);
  private running = false;

  constructor(
    private readonly webhooks: WebhooksService,
    private readonly prisma: PrismaService,
  ) {}

  @Interval('webhook-deliveries', 10_000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Una sola réplica por tick (si otra tiene el lock, se omite).
      await withAdvisoryLock(this.prisma, 'prestige:webhook-deliveries', () => this.webhooks.dispatchDue());
    } catch (error) {
      this.log.error(`dispatchDue falló: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
