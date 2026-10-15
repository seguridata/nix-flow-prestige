import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Observable, from, of } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { RedisService } from '../redis/redis.service';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_TTL_S = 24 * 60 * 60;
/** Una ejecución "en curso" bloquea la clave a lo sumo este tiempo (si el proceso muere, se libera). */
export const IDEMPOTENCY_PENDING_TTL_S = 120;
export const IDEMPOTENCY_MAX_BODY_BYTES = 256 * 1024;
const SAFE_KEY = /^[A-Za-z0-9._:~-]{1,100}$/;
const HTTP_CODE_METADATA = '__httpCode__';

interface StoredRecord {
  state: 'pending' | 'done';
  fp: string;
  status?: number;
  body?: unknown;
}

/** `true` si la clave es segura (1-100 caracteres: letras, dígitos, `. _ : ~ -`). */
export function isSafeIdempotencyKey(v: unknown): v is string {
  return typeof v === 'string' && SAFE_KEY.test(v);
}

export function idempotencyRedisKey(tenantId: string, actorId: string, key: string): string {
  return `idem:${tenantId}:${actorId}:${key}`;
}

/** Huella de la petición: método + ruta (con query) + hash del cuerpo. */
export function requestFingerprint(method: string, url: string, body: unknown): string {
  const bodyHash = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
  return createHash('sha256').update(`${method.toUpperCase()} ${url}\n${bodyHash}`).digest('hex');
}

/** Solo se guardan respuestas JSON (objeto/array/escalar) de hasta 256 KB; nada de streams ni buffers. */
export function cacheableBody(body: unknown): { ok: true; json: string } | { ok: false } {
  if (body === undefined || body === null || typeof body !== 'object') {
    return body === undefined ? { ok: false } : { ok: true, json: JSON.stringify(body) ?? 'null' };
  }
  if (Buffer.isBuffer(body) || typeof (body as { pipe?: unknown }).pipe === 'function' || typeof (body as { getStream?: unknown }).getStream === 'function') {
    return { ok: false };
  }
  try {
    const json = JSON.stringify(body);
    return json !== undefined && Buffer.byteLength(json) <= IDEMPOTENCY_MAX_BODY_BYTES ? { ok: true, json } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Idempotencia para POST con cabecera `Idempotency-Key`.
 *
 * Guarda en Redis `idem:{tenantId}:{actorId}:{key}` (24 h) el resultado de la
 * primera ejecución (solo 2xx JSON ≤ 256 KB) y lo reutiliza con la misma clave y
 * la misma huella (método+ruta+cuerpo). Misma clave con otra petición => 422;
 * primera aún en curso => 409. No actúa sin Redis, sin cabecera, sin usuario
 * autenticado (rutas públicas), en multipart ni en respuestas que no sean JSON
 * (descargas/streams). Si Redis falla, deja pasar la petición (fail-open).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly log = new Logger(IdempotencyInterceptor.name);

  constructor(@Optional() private readonly redis?: RedisService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    if (String(req?.method ?? '').toUpperCase() !== 'POST') return next.handle();
    const rawKey = req.headers?.[IDEMPOTENCY_HEADER];
    if (rawKey === undefined) return next.handle();
    const client = this.redis?.client() ?? null;
    if (!client) return next.handle();
    const tenantId = req.user?.tenantId;
    const actorId = req.user?.actorId;
    if (typeof tenantId !== 'string' || typeof actorId !== 'string' || !tenantId || !actorId) return next.handle();
    if (String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('multipart/')) return next.handle();
    if (!isSafeIdempotencyKey(rawKey)) {
      throw new BadRequestException('Idempotency-Key inválida (1-100 caracteres: letras, dígitos, . _ : ~ -)');
    }

    const redisKey = idempotencyRedisKey(tenantId, actorId, rawKey);
    const fp = requestFingerprint(req.method, req.originalUrl ?? req.url ?? '', req.body);
    const pending: StoredRecord = { state: 'pending', fp };

    let acquired: boolean;
    let existing: StoredRecord | null = null;
    try {
      acquired = (await client.set(redisKey, JSON.stringify(pending), 'EX', IDEMPOTENCY_PENDING_TTL_S, 'NX')) === 'OK';
      if (!acquired) {
        const raw = await client.get(redisKey);
        existing = raw ? (JSON.parse(raw) as StoredRecord) : null;
        // La clave expiró entre el SET y el GET: se trata como nueva en la próxima petición.
        if (!existing) return next.handle();
      }
    } catch (error) {
      this.log.warn(`Idempotency-Key omitida (Redis): ${(error as Error).message}`);
      return next.handle();
    }

    if (existing) {
      if (existing.fp !== fp) {
        throw new UnprocessableEntityException('Idempotency-Key ya se usó con una petición distinta');
      }
      if (existing.state === 'pending') {
        throw new ConflictException('Una petición con esta Idempotency-Key sigue en curso');
      }
      res.setHeader?.('Idempotent-Replay', 'true');
      if (existing.status) res.status?.(existing.status);
      return of(existing.body);
    }

    const handlerStatus = Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as number | undefined;
    const release = () => client.del(redisKey).catch(() => undefined);
    return next.handle().pipe(
      mergeMap((body) =>
        from(
          (async () => {
            const status = handlerStatus ?? 201;
            const cached = res.headersSent || (res.getHeader?.('content-type') && !String(res.getHeader('content-type')).includes('json'))
              ? ({ ok: false } as const)
              : cacheableBody(body);
            try {
              if (cached.ok && status >= 200 && status < 300) {
                const record: StoredRecord = { state: 'done', fp, status, body: JSON.parse(cached.json) };
                await client.set(redisKey, JSON.stringify(record), 'EX', IDEMPOTENCY_TTL_S);
              } else {
                await release();
              }
            } catch (error) {
              this.log.warn(`Idempotency-Key no guardada: ${(error as Error).message}`);
              await release();
            }
            return body;
          })(),
        ),
      ),
      // Falla (4xx/5xx): se libera la clave para que el cliente pueda reintentar.
      catchError((error) =>
        from(release()).pipe(
          mergeMap(() => {
            throw error;
          }),
        ),
      ),
    );
  }
}
