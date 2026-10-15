import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Tope de uso de IA por tenant, para que un cliente no agote el costo ni la capacidad de los demás.
 * Dos ventanas: por minuto (`AI_RPM_PER_TENANT`, 10) y por mes (`AI_MONTHLY_PER_TENANT`, 300).
 * Los contadores viven en Redis con el tenant en la clave, así que valen para todas las réplicas.
 * Sin Redis (solo desarrollo) o si Redis falla, cuenta en memoria de la réplica.
 */
@Injectable()
export class AiQuotaService {
  private readonly log = new Logger(AiQuotaService.name);
  private readonly memory = new Map<string, { n: number; expires: number }>();

  constructor(private readonly redis: RedisService) {}

  private async bump(key: string, ttlSeconds: number): Promise<number> {
    const client = this.redis.client();
    if (client) {
      try {
        const n = await client.incr(key);
        if (n === 1) await client.expire(key, ttlSeconds);
        return n;
      } catch (e) {
        this.log.warn(`Redis no disponible para la cuota de IA; uso memoria local: ${(e as Error).message}`);
      }
    }
    const now = Date.now();
    if (this.memory.size > 5000) for (const [k, v] of this.memory) if (v.expires < now) this.memory.delete(k);
    const cur = this.memory.get(key);
    const entry = cur && cur.expires > now ? cur : { n: 0, expires: now + ttlSeconds * 1000 };
    entry.n++;
    this.memory.set(key, entry);
    return entry.n;
  }

  /** Cuenta una solicitud de IA del tenant o responde 429 si superó un tope. */
  async consume(tenantId: string): Promise<void> {
    const now = new Date();
    const minute = Math.floor(now.getTime() / 60_000);
    const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const perMinute = await this.bump(`ai:rl:${tenantId}:${minute}`, 90);
    if (perMinute > num('AI_RPM_PER_TENANT', 10)) {
      throw new HttpException('Demasiadas solicitudes de IA en un minuto. Espera un momento y vuelve a intentar.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const perMonth = await this.bump(`ai:q:${tenantId}:${month}`, 40 * 24 * 3600);
    if (perMonth > num('AI_MONTHLY_PER_TENANT', 300)) {
      throw new HttpException('Se alcanzó el límite mensual de solicitudes de IA de tu organización.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
