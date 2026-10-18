import { createHash, createHmac } from 'node:crypto';

/**
 * Firma del canal interno worker -> BFF. SIN dependencias de Nest: la importan
 * tanto `WorkerGuard` (verifica) como `temporal/activities.ts` (firma).
 *
 * Formato: HMAC-SHA256(secret, `v1\n<ts>\n<METHOD>\n<path>\n<sha256(body)>`)
 * Cabeceras: `x-prestige-worker-ts` (epoch ms) y `x-prestige-worker-token` (hex).
 */
export const WORKER_TOKEN_HEADER = 'x-prestige-worker-token';
export const WORKER_TS_HEADER = 'x-prestige-worker-ts';
export const WORKER_WINDOW_MS = 60_000;

/** Path sin query ni fragmento, para que firmante y verificador coincidan. */
export function canonicalPath(url: string): string {
  return url.split('#')[0]!.split('?')[0]!;
}

export function bodyDigest(body: unknown): string {
  return createHash('sha256')
    .update(body === undefined || body === null ? '' : JSON.stringify(body))
    .digest('hex');
}

export function signWorkerRequest(
  secret: string,
  req: { method: string; path: string; body?: unknown; ts?: number },
): { ts: string; token: string } {
  const ts = String(req.ts ?? Date.now());
  const token = createHmac('sha256', secret)
    .update(`v1\n${ts}\n${req.method.toUpperCase()}\n${canonicalPath(req.path)}\n${bodyDigest(req.body)}`)
    .digest('hex');
  return { ts, token };
}
