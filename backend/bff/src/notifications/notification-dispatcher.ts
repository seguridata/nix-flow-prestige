import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { withAdvisoryLock } from '../common/advisory-lock';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationOutboxService } from './notification-outbox.service';

/**
 * M13 — despachador de la bandeja de salida. Cada 15 s procesa los correos
 * vencidos (reintentos con backoff exponencial; a DLQ tras `maxAttempts`).
 * Se salta el trabajo si SMTP no está configurado.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly log = new Logger(NotificationDispatcher.name);
  private running = false;

  constructor(
    private readonly outbox: NotificationOutboxService,
    private readonly prisma: PrismaService,
  ) {}

  @Interval('notification-outbox', 15_000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Una sola réplica por tick; el claim SKIP LOCKED del outbox cubre además el solape.
      await withAdvisoryLock(this.prisma, 'prestige:notification-outbox', () => this.outbox.dispatchDue());
    } catch (error) {
      this.log.error(`dispatchDue falló: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
