import { CONTRATO_DOS_PARTES, type ContratoWorkflowInput } from './shared';

/**
 * Activities talk to the BFF over HTTP so the workflow sandbox never
 * imports Nest/Prisma. The BFF exposes internal endpoints for the worker.
 */
const bffBase = () => process.env.BFF_INTERNAL_URL ?? 'http://127.0.0.1:3000';

async function post(path: string, body: unknown) {
  const res = await fetch(`${bffBase()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-prestige-worker': '1' },
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

export async function sealEvidence(signatureRequestId: string) {
  return post('/internal/workflows/seal-evidence', { signatureRequestId });
}
