import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer.service';

export interface EnqueueEmail {
  to: string;
  subject: string;
  html: string;
  template?: string;
  payload?: Record<string, unknown>;
  /** Idempotencia: si ya existe una fila con este dedupeKey, no se vuelve a encolar. */
  dedupeKey?: string;
}

/** Backoff exponencial acotado: 1, 2, 4, 8, 16, 30 min. */
function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt, 30) * 60_000;
}

@Injectable()
export class NotificationOutboxService {
  private readonly log = new Logger(NotificationOutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  async enqueueEmail(msg: EnqueueEmail) {
    if (!msg.to) return null;
    try {
      return await this.prisma.notificationOutbox.create({
        data: {
          channel: 'email',
          toAddress: msg.to,
          subject: msg.subject,
          body: msg.html,
          template: msg.template,
          payload: (msg.payload ?? undefined) as Prisma.InputJsonValue | undefined,
          dedupeKey: msg.dedupeKey,
        },
      });
    } catch (error) {
      // Choque de dedupeKey único → ya estaba encolado, no es un error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  /** Procesa un lote de mensajes vencidos. Devuelve el conteo por resultado. */
  async dispatchDue(limit = 25) {
    if (!this.mailer.enabled) return { skipped: true as const, sent: 0, failed: 0, dead: 0 };

    const due = await this.prisma.notificationOutbox.findMany({
      where: { status: { in: ['PENDIENTE', 'FALLIDO'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });

    let sent = 0;
    let failed = 0;
    let dead = 0;

    for (const row of due) {
      try {
        await this.mailer.send({ to: row.toAddress, subject: row.subject, html: row.body });
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: { status: 'ENVIADO', sentAt: new Date(), lastError: null, attempts: { increment: 1 } },
        });
        sent += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        const toDlq = attempts >= row.maxAttempts;
        await this.prisma.notificationOutbox.update({
          where: { id: row.id },
          data: {
            status: toDlq ? 'DLQ' : 'FALLIDO',
            attempts,
            lastError: message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
          },
        });
        if (toDlq) {
          dead += 1;
          this.log.error(`Outbox ${row.id} → DLQ tras ${attempts} intentos: ${message}`);
        } else {
          failed += 1;
        }
      }
    }

    if (sent || failed || dead) this.log.log(`Outbox: ${sent} enviados, ${failed} reintentables, ${dead} a DLQ`);
    return { skipped: false as const, sent, failed, dead };
  }

  list(params: { status?: string; take?: number }) {
    return this.prisma.notificationOutbox.findMany({
      where: params.status ? { status: params.status as never } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.take ?? 100, 500),
    });
  }

  async retry(id: string) {
    const row = await this.prisma.notificationOutbox.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Mensaje ${id} no encontrado`);
    return this.prisma.notificationOutbox.update({
      where: { id },
      data: { status: 'PENDIENTE', nextAttemptAt: new Date(), lastError: null },
    });
  }
}
