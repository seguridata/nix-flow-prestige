import { WORKER_TOKEN_HEADER, WORKER_TS_HEADER, signWorkerRequest } from '../auth/worker-signature';
import { CONTRATO_DOS_PARTES, type ContratoWorkflowInput, type NudgeCommand } from './shared';

/**
 * Activities talk to the BFF over HTTP so the workflow sandbox never
 * imports Nest/Prisma. The BFF exposes internal endpoints for the worker,
 * protegidos por WorkerGuard: cada petición se firma con HMAC sobre
 * (timestamp, método, path, hash del body) usando WORKER_SHARED_SECRET
 * (ver backend/bff/src/auth/worker-signature.ts); el BFF acepta ±60 s y
 * rechaza replays.
 */
const bffBase = () => process.env.BFF_INTERNAL_URL ?? 'http://127.0.0.1:3000';
const REQUEST_TIMEOUT_MS = 30_000;

async function post(path: string, body: unknown) {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) {
    throw new Error('WORKER_SHARED_SECRET no está definido para el worker de Temporal');
  }
  // La firma se calcula sobre el MISMO objeto que se serializa en el body.
  const { ts, token } = signWorkerRequest(secret, { method: 'POST', path, body });
  const res = await fetch(`${bffBase()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [WORKER_TOKEN_HEADER]: token,
      [WORKER_TS_HEADER]: ts,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
