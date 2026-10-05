import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import {
  WORKER_TOKEN_HEADER,
  WORKER_TS_HEADER,
  WORKER_WINDOW_MS,
  canonicalPath,
  signWorkerRequest,
} from './worker-signature';

export { WORKER_TOKEN_HEADER, WORKER_TS_HEADER } from './worker-signature';

/**
 * Autentica el canal interno worker -> BFF (`/internal/*`).
 *
 * El worker firma HMAC-SHA256 sobre (timestamp, método, path, hash del body)
 * con `WORKER_SHARED_SECRET` (ver `worker-signature.ts`). El guard:
 *  - exige `x-prestige-worker-ts` dentro de ±60 s;
 *  - recalcula la firma (la petición queda atada a ESE método/path/body);
 *  - rechaza replays: una firma ya vista dentro de la ventana no se acepta de
 *    nuevo (caché en memoria; con varias réplicas del BFF cada una cubre su
 *    propio tráfico — el timestamp sigue acotando la ventana).
 */
@Injectable()
export class WorkerGuard implements CanActivate {
  private readonly seen = new Map<string, number>();

  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.WORKER_SHARED_SECRET;
    if (!secret) {
      throw new UnauthorizedException('WORKER_SHARED_SECRET no configurado en el BFF');
    }
    const req = context.switchToHttp().getRequest();
    const provided = String(req.headers?.[WORKER_TOKEN_HEADER] ?? '');
    const tsRaw = String(req.headers?.[WORKER_TS_HEADER] ?? '');
    if (!provided || !tsRaw) throw new UnauthorizedException('Falta la firma del worker');

    const ts = Number(tsRaw);
    const now = Date.now();
    if (!Number.isFinite(ts) || Math.abs(now - ts) > WORKER_WINDOW_MS) {
      throw new UnauthorizedException('Firma de worker fuera de la ventana de tiempo');
    }

    const expected = signWorkerRequest(secret, {
      method: String(req.method ?? ''),
      path: canonicalPath(String(req.originalUrl ?? req.url ?? '')),
      body: req.body,
      ts,
    }).token;
    if (!safeEqual(expected, provided)) {
      throw new UnauthorizedException('Firma de worker inválida');
    }

    // Anti-replay: purga las expiradas y rechaza una firma ya consumida.
    for (const [sig, until] of this.seen) if (until <= now) this.seen.delete(sig);
    if (this.seen.has(provided)) throw new UnauthorizedException('Firma de worker ya utilizada');
    this.seen.set(provided, ts + WORKER_WINDOW_MS);
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
