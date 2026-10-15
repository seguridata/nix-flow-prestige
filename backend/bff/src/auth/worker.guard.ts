import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { RedisService } from '../redis/redis.service';
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
 *    nuevo. Con Redis se registra con `SET key 1 NX EX 60` (compartido entre
 *    réplicas del BFF); sin Redis, o si Redis falla, cae a un Map en memoria
 *    (cada réplica cubre su tráfico; el timestamp sigue acotando la ventana).
 */
@Injectable()
export class WorkerGuard implements CanActivate {
  private readonly seen = new Map<string, number>();

  constructor(@Optional() private readonly redis?: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    // Anti-replay: rechaza una firma ya consumida dentro de la ventana.
    if (!(await this.markSeen(provided, ts, now))) {
      throw new UnauthorizedException('Firma de worker ya utilizada');
    }
    return true;
  }

  /** @returns true si la firma es nueva (se registra); false si es un replay. */
  private async markSeen(sig: string, ts: number, now: number): Promise<boolean> {
    const client = this.redis?.client() ?? null;
    if (client) {
      try {
        const ok = await client.set(`worker-sig:${sig}`, '1', 'EX', Math.ceil((WORKER_WINDOW_MS * 2) / 1000), 'NX');
        return ok === 'OK';
      } catch {
        /* Redis caído: respaldo en memoria */
      }
    }
    for (const [k, until] of this.seen) if (until <= now) this.seen.delete(k);
    if (this.seen.has(sig)) return false;
    this.seen.set(sig, ts + WORKER_WINDOW_MS);
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
