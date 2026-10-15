import { ThrottlerGuard } from '@nestjs/throttler';
import { envPositiveInt } from './env-number';

interface TrackedRequest {
  user?: { tenantId?: unknown; actorId?: unknown };
  ip?: string;
  ips?: string[];
  socket?: { remoteAddress?: string };
}

/**
 * Clave del rate-limit: `tenantId:actorId` en rutas autenticadas (un usuario
 * no consume el cupo de otro tras el mismo NAT/proxy, ni un tenant el de otro);
 * IP como respaldo en rutas públicas o sin usuario.
 */
export function throttleTracker(req: TrackedRequest): string {
  const tenantId = req.user?.tenantId;
  const actorId = req.user?.actorId;
  if (typeof tenantId === 'string' && tenantId && typeof actorId === 'string' && actorId) {
    return `${tenantId}:${actorId}`;
  }
  return req.ips?.[0] || req.ip || req.socket?.remoteAddress || 'unknown';
}

/** ThrottlerGuard con tracker `tenantId:actorId`. Debe ejecutarse DESPUÉS de los guards de auth. */
export class PrestigeThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return throttleTracker(req as TrackedRequest);
  }
}

/** Límite por ventana (ms) para `@Throttle`. Configurable por env; se lee al cargar el módulo. */
function limitFor(prefix: string, defaults: { limit: number; ttlMs: number }) {
  return {
    default: {
      limit: envPositiveInt(`THROTTLE_${prefix}_LIMIT`, defaults.limit),
      ttl: envPositiveInt(`THROTTLE_${prefix}_TTL_MS`, defaults.ttlMs),
    },
  };
}

/** Subida de documentos (por defecto 30/min por usuario). */
export const UPLOAD_THROTTLE = limitFor('UPLOAD', { limit: 30, ttlMs: 60_000 });
/** Onboarding: INE / selfie / OCR (por defecto 20/min por usuario). */
export const ONBOARDING_THROTTLE = limitFor('ONBOARDING', { limit: 20, ttlMs: 60_000 });
/** `/ai/*`: cada llamada cuesta tokens (por defecto 10/min por usuario). */
export const AI_THROTTLE = limitFor('AI', { limit: 10, ttlMs: 60_000 });
