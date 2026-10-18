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
    const snap = await svc.snapshotGlobal();
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
    const snap = await svc.snapshotGlobal();
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
    const snap = await svc.snapshotGlobal();
    expect(snap.overall).toBe('ok');
    expect(snap.indicators.avgHoursToComplete.value).toBeNull();
  });
});

describe('SloService: alcance explícito por tenant', () => {
  function spyPrisma() {
    const wheres: Record<string, unknown>[] = [];
    const raw: unknown[][] = [];
    const count = async ({ where }: { where?: Record<string, unknown> }) => {
      wheres.push(where ?? {});
      return 0;
    };
    const prisma = {
      signatureRequest: { count },
      workflowRun: { count },
      notificationOutbox: { count },
      webhookDelivery: { count },
      humanTask: { count },
      $queryRaw: async (...args: unknown[]) => {
        raw.push(args);
        return [{ avg_seconds: null }];
      },
    } as unknown as PrismaService;
    return { prisma, wheres, raw };
  }

  it('snapshot(tenant) acota TODOS los conteos y el SQL crudo a ese tenant', async () => {
    const { prisma, wheres, raw } = spyPrisma();
    await new SloService(prisma).snapshot('acme');
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres.filter((x) => !('subscription' in x))) expect(w.tenantId).toBe('acme');
    expect(wheres.find((x) => 'subscription' in x)?.subscription).toEqual({ tenantId: 'acme' });
    expect(JSON.stringify(raw[0])).toContain('acme');
  });

  it('snapshot sin tenant (o vacío) falla cerrado en vez de caer a la vista global', async () => {
    const { prisma, wheres } = spyPrisma();
    const svc = new SloService(prisma);
    await expect(svc.snapshot('')).rejects.toThrow(/tenantId/);
    await expect(svc.snapshot(undefined as unknown as string)).rejects.toThrow(/tenantId/);
    expect(wheres).toHaveLength(0);
  });

  it('snapshotGlobal es la única vista sin filtro de tenant', async () => {
    const { prisma, wheres } = spyPrisma();
    await new SloService(prisma).snapshotGlobal();
    for (const w of wheres) expect(w.tenantId).toBeUndefined();
  });
});
