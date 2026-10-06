import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import { withAdvisoryLock } from '../common/advisory-lock';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from './workflow.service';

/** Estados terminales "malos" de Temporal (nombres de `WorkflowExecutionStatusName`). */
const BAD_STATES = new Set(['FAILED', 'TIMED_OUT', 'TERMINATED', 'CANCELLED']);
/** Antigüedad mínima (sobre `updatedAt`) para no pisar un arranque en curso. */
export const RECONCILE_MIN_AGE_MS = 2 * 60_000;
/** Marca en `lastError` de que ya se reinició una vez (no reiniciar en bucle). */
export const RESTART_MARK = 'restarted:1';

/**
 * Desincronización Temporal↔BD: si un workflow terminó mal en Temporal, el
 * WorkflowRun seguiría ACTIVO para siempre. Cada minuto compara los runs
 * ACTIVO "viejos" con Temporal y los marca FALLIDO; si la solicitud sigue
 * EN_FIRMA reintenta UNA vez (idempotente vía `startInstance`).
 */
@Injectable()
export class WorkflowReconcilerService {
  private readonly log = new Logger(WorkflowReconcilerService.name);
  private running = false;
  private clientPromise: Promise<Client> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
  ) {}

  protected client(): Promise<Client> {
    if (!this.clientPromise) {
      const p = (async () => {
        const connection = await Connection.connect({
          address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
        });
        return new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' });
      })();
      // Si la conexión falla, no cachear el rechazo: reintentar en el próximo tick.
      p.catch(() => {
        if (this.clientPromise === p) this.clientPromise = null;
      });
      this.clientPromise = p;
    }
    return this.clientPromise;
  }

  @Interval('workflow-reconciler', 60_000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await withAdvisoryLock(this.prisma, 'prestige:workflow-reconciler', () => this.reconcile());
    } catch (error) {
      this.log.error(`reconcile: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async reconcile(now = new Date()) {
    const result = { checked: 0, failed: 0, restarted: 0 };
    const runs = await this.prisma.workflowRun.findMany({
      where: { status: 'ACTIVO', updatedAt: { lt: new Date(now.getTime() - RECONCILE_MIN_AGE_MS) } },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    if (runs.length === 0) return result;

    let client: Client;
    try {
      client = await this.client();
    } catch (error) {
      this.log.warn(`Temporal no disponible; se omite la reconciliación: ${(error as Error).message}`);
      return result;
    }

    for (const run of runs) {
      let reason: string;
      try {
        const desc = await client.workflow.getHandle(run.workflowId).describe();
        const state = String(desc.status?.name ?? 'UNKNOWN');
        if (!BAD_STATES.has(state)) {
          result.checked += 1;
          continue;
        }
        reason = `Temporal: ${state}`;
      } catch (error) {
        if (error instanceof WorkflowNotFoundError || (error as { name?: string })?.name === 'WorkflowNotFoundError') {
          reason = 'no existe en Temporal';
        } else {
          this.log.warn(`Temporal no respondió para ${run.workflowId}: ${(error as Error).message}`);
          continue;
        }
      }
      result.checked += 1;
      try {
        if (await this.handleFailed(run, reason)) result.restarted += 1;
        else result.failed += 1;
      } catch (error) {
        this.log.error(`No se pudo reconciliar ${run.workflowId}: ${(error as Error).message}`);
      }
    }
    return result;
  }

  /** @returns true si se reinició, false si quedó FALLIDO. */
  private async handleFailed(
    run: { signatureRequestId: string; processKey: string; tenantId: string | null; lastError: string | null },
    reason: string,
  ): Promise<boolean> {
    const alreadyRestarted = (run.lastError ?? '').includes(RESTART_MARK);
    const request = alreadyRestarted
      ? null
      : await this.prisma.signatureRequest.findUnique({
          where: { id: run.signatureRequestId },
          include: { signers: { orderBy: { sortOrder: 'asc' } } },
        });

    if (request && request.status === 'EN_FIRMA') {
      this.log.warn(`Flujo de ${run.signatureRequestId} en ${reason}; se reinicia una vez`);
      await this.workflow.startInstance(
        run.processKey,
        run.signatureRequestId,
        {
          signatureRequestId: run.signatureRequestId,
          documentId: request.documentId,
          order: request.order,
          signers: request.signers.map((s) => ({ signerId: s.signerId, name: s.name ?? undefined })),
        },
        request.tenantId ?? run.tenantId ?? undefined,
      );
      // startInstance limpia lastError: se deja la marca para no reiniciar en bucle.
      await this.prisma.workflowRun.updateMany({
        where: { signatureRequestId: run.signatureRequestId },
        data: { lastError: `${RESTART_MARK} (${reason})` },
      });
      return true;
    }

    await this.prisma.workflowRun.updateMany({
      where: { signatureRequestId: run.signatureRequestId, status: 'ACTIVO' },
      data: { status: 'FALLIDO', lastError: alreadyRestarted ? `${reason} ${RESTART_MARK}` : reason },
    });
    return false;
  }
}
