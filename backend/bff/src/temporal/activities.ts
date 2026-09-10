import { createHmac } from 'node:crypto';
import { CONTRATO_DOS_PARTES, type ContratoWorkflowInput, type NudgeCommand } from './shared';

/**
 * Activities talk to the BFF over HTTP so the workflow sandbox never
 * imports Nest/Prisma. The BFF exposes internal endpoints for the worker,
 * protegidos por WorkerGuard: hay que firmar un token HMAC del minuto actual
 * con WORKER_SHARED_SECRET (mismo algoritmo que backend/bff/src/auth/worker.guard.ts).
 */
const bffBase = () => process.env.BFF_INTERNAL_URL ?? 'http://127.0.0.1:3000';

function workerToken(): string {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) {
    throw new Error('WORKER_SHARED_SECRET no está definido para el worker de Temporal');
  }
  const minute = Math.floor(Date.now() / 60_000);
  return createHmac('sha256', secret).update(`worker:${minute}`).digest('hex');
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${bffBase()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-prestige-worker-token': workerToken(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Activity ${path} failed (${res.status}): ${text}`);
  }
  return res.json().catch(() => ({}));
}

export async function seedHumanTasks(input: ContratoWorkflowInput) {
  return post('/internal/workflows/seed-tasks', {
    ...input,
    processKey: CONTRATO_DOS_PARTES,
  });
}

export async function markExpired(signatureRequestId: string) {
  return post('/internal/workflows/expire', { signatureRequestId });
}

/**
 * M07 — recordatorio / escalamiento disparado por un timer del workflow.
 * El BFF crea las notificaciones y los eventos de auditoría reales.
 */
export async function sendNudge(command: NudgeCommand) {
  return post('/internal/workflows/nudge', command);
}

export async function sealEvidence(signatureRequestId: string) {
  return post('/internal/workflows/seal-evidence', { signatureRequestId });
}
