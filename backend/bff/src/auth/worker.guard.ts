import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

export const WORKER_TOKEN_HEADER = 'x-prestige-worker-token';

/**
 * Autentica el canal interno worker → BFF (`/internal/*`). El worker firma
 * `HMAC-SHA256(minuto-actual)` con `WORKER_SHARED_SECRET` y lo envía en
 * `X-Prestige-Worker-Token`. Se aceptan el minuto actual y el anterior para
 * tolerar desfase de reloj. Reemplaza al header decorativo `x-prestige-worker: 1`
 * que antes no se validaba.
 */
@Injectable()
export class WorkerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.WORKER_SHARED_SECRET;
    if (!secret) {
      throw new UnauthorizedException('WORKER_SHARED_SECRET no configurado en el BFF');
    }
    const req = context.switchToHttp().getRequest();
    const provided = String(req.headers?.[WORKER_TOKEN_HEADER] ?? '');
    if (!provided) throw new UnauthorizedException('Falta X-Prestige-Worker-Token');

    const now = Math.floor(Date.now() / 60_000);
    const candidates = [signWorkerToken(secret, now), signWorkerToken(secret, now - 1)];
    const ok = candidates.some((c) => safeEqual(c, provided));
    if (!ok) throw new UnauthorizedException('Token de worker inválido o expirado');
    return true;
  }
}

export function signWorkerToken(secret: string, minute = Math.floor(Date.now() / 60_000)): string {
  return createHmac('sha256', secret).update(`worker:${minute}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
