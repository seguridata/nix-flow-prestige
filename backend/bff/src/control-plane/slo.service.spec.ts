import { describe, expect, it } from 'vitest';
import { SloService } from './slo.service';
import type { PrismaService } from '../prisma/prisma.service';

function fakePrisma(counts: Record<string, number>, avgSeconds: number | null = null) {
  const c = (k: string) => counts[k] ?? 0;
  return {
    signatureRequest: {
      count: async ({ where }: { where?: Record<string, unknown> }) => {
        const s = (where?.status as string) ?? 'all';
        return c(`sr:${s}`);
      },
    },
    $queryRaw: async () => [{ avg_seconds: avgSeconds }],
    workflowRun: {
      count: async ({ where }: { where?: Record<string, unknown> }) =>
        where?.lastError ? c('run:broken') : c('run:local'),
    },
    notificationOutbox: { count: async () => c('outboxDlq') },
    webhookDelivery: { count: async () => c('webhookDlq') },
    humanTask: { count: async () => c('overdue') },
  } as unknown as PrismaService;
}

describe('SloService.snapshot', () => {
  it('todo verde cuando el caso ancla va bien', async () => {
    const svc = new SloService(
      fakePrisma({ 'sr:all': 20, 'sr:COMPLETADA': 19, 'sr:EXPIRADA': 0 }),
    );
    const snap = await svc.snapshot();
    expect(snap.overall).toBe('ok');
    expect(snap.indicators.successRate.value).toBe(1);
    expect(snap.indicators.successRate.level).toBe('ok');
  });

  it('marca crit con runs rotos y DLQ altos', async () => {
    const svc = new SloService(
      fakePrisma({
        'sr:all': 10,
        'sr:COMPLETADA': 5,
        'sr:EXPIRADA': 5,
        'run:broken': 6,
        'webhookDlq': 12,
      }),
    );
    const snap = await svc.snapshot();
    expect(snap.indicators.brokenWorkflowRuns.level).toBe('crit');
    expect(snap.indicators.webhookDlq.level).toBe('crit');
    expect(snap.indicators.expiryRate.level).toBe('crit'); // 50% expiran
    expect(snap.overall).toBe('crit');
  });

  it('tiempo medio a COMPLETADA sale de la agregación SQL (segundos -> horas)', async () => {
    const svc = new SloService(fakePrisma({ 'sr:all': 4, 'sr:COMPLETADA': 4 }, 7200));
    const snap = await svc.snapshot('t1');
    expect(snap.indicators.avgHoursToComplete.value).toBe(2);
  });

  it('sin datos (0 solicitudes) no revienta y da ok', async () => {
    const svc = new SloService(fakePrisma({}));
    const snap = await svc.snapshot();
    expect(snap.overall).toBe('ok');
    expect(snap.indicators.avgHoursToComplete.value).toBeNull();
  });
});
