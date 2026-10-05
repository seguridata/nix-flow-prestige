import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Level = 'ok' | 'warn' | 'crit';

function grade(value: number, warn: number, crit: number, higherIsBad = true): Level {
  if (higherIsBad) return value >= crit ? 'crit' : value >= warn ? 'warn' : 'ok';
  return value <= crit ? 'crit' : value <= warn ? 'warn' : 'ok';
}

/**
 * M15 — SLO / presupuesto de error del caso ancla. Sin backend de métricas:
 * se calcula al vuelo desde Postgres. `/operations/slo`.
 */
@Injectable()
export class SloService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `tenantId` acota TODOS los conteos a ese tenant. Sin él (solo
   * `platform_admin`) la vista es global.
   */
  async snapshot(tenantId?: string) {
    const t = tenantId ? { tenantId } : {};
    const since = new Date(Date.now() - 7 * 24 * 3600_000);

    const [total7d, completed7d, expired7d, brokenRuns, localRuns, outboxDlq, webhookDlq, overdueTasks] =
      await Promise.all([
        this.prisma.signatureRequest.count({ where: { ...t, createdAt: { gte: since } } }),
        this.prisma.signatureRequest.count({ where: { ...t, createdAt: { gte: since }, status: 'COMPLETADA' } }),
        this.prisma.signatureRequest.count({ where: { ...t, createdAt: { gte: since }, status: 'EXPIRADA' } }),
        this.prisma.workflowRun.count({ where: { ...t, lastError: { not: null } } }),
        this.prisma.workflowRun.count({ where: { ...t, status: 'LOCAL' } }),
        this.prisma.notificationOutbox.count({ where: { ...t, status: 'DLQ' } }),
        this.prisma.webhookDelivery.count({
          where: { status: 'DLQ', ...(tenantId ? { subscription: { tenantId } } : {}) },
        }),
        this.prisma.humanTask.count({
          where: { ...t, status: { in: ['CREADA', 'ASIGNADA'] }, dueAt: { lt: new Date() } },
        }),
      ]);

    const closed7d = completed7d + expired7d;
    const successRate = closed7d > 0 ? completed7d / closed7d : 1;
    const expiryRate = closed7d > 0 ? expired7d / closed7d : 0;

    // Tiempo medio a COMPLETADA (7 d): agregación en Postgres sobre TODAS las
    // solicitudes de la ventana (antes: muestra de 500 en memoria), acotada por
    // tenant (si hay) y por la ventana de tiempo.
    const rows = await this.prisma.$queryRaw<{ avg_seconds: number | null }[]>(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM (m."createdAt" - r."createdAt")))::float8 AS avg_seconds
      FROM "SignatureRequest" r
      JOIN "EvidenceManifest" m ON m."signatureRequestId" = r."id"
      WHERE r."createdAt" >= ${since}
        AND r."status" = 'COMPLETADA'
        AND m."createdAt" >= r."createdAt"
        ${tenantId ? Prisma.sql`AND r."tenantId" = ${tenantId}` : Prisma.empty}
    `);
    const avgSeconds = rows[0]?.avg_seconds;
    const avgHoursToComplete = avgSeconds === null || avgSeconds === undefined ? null : Number(avgSeconds) / 3600;

    const indicators = {
      successRate: {
        value: Number(successRate.toFixed(4)),
        objective: 0.95,
        level: grade(successRate, 0.95, 0.9, false),
      },
      expiryRate: {
        value: Number(expiryRate.toFixed(4)),
        budget: 0.05,
        level: grade(expiryRate, 0.05, 0.1),
      },
      brokenWorkflowRuns: { value: brokenRuns, level: grade(brokenRuns, 1, 5) },
      localWorkflowRuns: { value: localRuns, level: grade(localRuns, 1, 10) },
      notificationDlq: { value: outboxDlq, level: grade(outboxDlq, 1, 10) },
      webhookDlq: { value: webhookDlq, level: grade(webhookDlq, 1, 10) },
      overdueTasks: { value: overdueTasks, level: grade(overdueTasks, 5, 25) },
      avgHoursToComplete:
        avgHoursToComplete === null
          ? { value: null, level: 'ok' as Level }
          : { value: Number(avgHoursToComplete.toFixed(2)), level: 'ok' as Level },
    };

    const levels = Object.values(indicators).map((i) => i.level);
    const overall: Level = levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : 'ok';

    return {
      window: '7d',
      sampledRequests: total7d,
      overall,
      indicators,
      at: new Date().toISOString(),
    };
  }
}
