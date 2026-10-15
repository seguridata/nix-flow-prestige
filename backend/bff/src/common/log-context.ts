import { randomUUID } from 'crypto';

/** Cabecera de correlación entre servicios (entrada y respuesta). */
export const CORRELATION_HEADER = 'x-correlation-id';
const SAFE_CORRELATION = /^[A-Za-z0-9-]{1,64}$/;

/** Rutas de salud que no se registran (ruido de sondas del LB/orquestador). */
const HEALTH_PATHS = new Set(['/operations/health', '/operations/health/live', '/operations/health/ready']);

/** `true` si el valor es un id de correlación seguro (máx. 64, alfanumérico y guiones). */
export function isSafeCorrelationId(v: unknown): v is string {
  return typeof v === 'string' && SAFE_CORRELATION.test(v);
}

/** Usa `x-correlation-id` si es seguro; si no, genera uno. */
export function resolveCorrelationId(header: unknown): string {
  const raw = Array.isArray(header) ? header[0] : header;
  return isSafeCorrelationId(raw) ? raw : randomUUID();
}

/** `genReqId` de pino-http: resuelve el id y lo devuelve en la respuesta. */
export function genReqId(
  req: { headers?: Record<string, unknown>; id?: unknown },
  res: { setHeader?: (name: string, value: string) => unknown },
): string {
  const id = resolveCorrelationId(req.headers?.[CORRELATION_HEADER]);
  res.setHeader?.(CORRELATION_HEADER, id);
  return id;
}

/**
 * Middleware temprano (main.ts): fija el id de correlación en `req.id` y en la respuesta ANTES del logger.
 * pino-http solo llama a `genReqId` si `req.id` está vacío, así que no basta con confiar en él.
 */
export function correlationMiddleware(
  req: { headers?: Record<string, unknown>; id?: unknown },
  res: { setHeader?: (name: string, value: string) => unknown },
  next: () => void,
): void {
  const id = resolveCorrelationId(req.headers?.[CORRELATION_HEADER]);
  req.id = id;
  res.setHeader?.(CORRELATION_HEADER, id);
  next();
}

/** `customProps`: agrega tenantId y actorId cuando la petición ya tiene usuario. */
export function logCustomProps(req: { user?: { tenantId?: unknown; actorId?: unknown } }): Record<string, string> {
  const props: Record<string, string> = {};
  if (typeof req.user?.tenantId === 'string') props.tenantId = req.user.tenantId;
  if (typeof req.user?.actorId === 'string') props.actorId = req.user.actorId;
  return props;
}

/** `autoLogging.ignore`: no registra las sondas de salud. */
export function ignoreHealthLog(req: { url?: string }): boolean {
  const path = (req.url ?? '').split('?')[0];
  return HEALTH_PATHS.has(path);
}
