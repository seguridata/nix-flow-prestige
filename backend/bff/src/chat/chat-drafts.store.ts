import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from '../redis/redis.service';
import type { TemplateDraftProposal } from './chat-proposals';

const TTL_SECONDS = 30 * 24 * 3600;
const MAX_LIST = 50;

export interface StoredTemplateDraft extends TemplateDraftProposal {
  id: string;
  tenantId: string;
  actorId: string;
  createdAt: string;
  status: 'BORRADOR';
}

/**
 * Borradores de formato sin PDF base. El schema de Prisma no tiene dónde guardarlos (un `DocumentTemplate`
 * exige PDF), así que viven en Redis con TTL de 30 días: sin estado en el proceso y con el tenant y el
 * autor en la clave. Un usuario solo lista los suyos y nunca los de otro tenant.
 */
@Injectable()
export class ChatDraftsStore {
  constructor(private readonly redis: RedisService) {}

  private key(tenantId: string, actorId: string, id: string) {
    return `chat:draft:${tenantId}:${actorId}:${id}`;
  }
  private index(tenantId: string, actorId: string) {
    return `chat:drafts:${tenantId}:${actorId}`;
  }

  async saveTemplate(tenantId: string, actorId: string, draft: TemplateDraftProposal): Promise<StoredTemplateDraft> {
    const client = this.redis.client();
    if (!client) throw new ServiceUnavailableException('Los borradores de formato necesitan Redis, que no está configurado.');
    const id = randomUUID();
    const stored: StoredTemplateDraft = { ...draft, id, tenantId, actorId, createdAt: new Date().toISOString(), status: 'BORRADOR' };
    await client.set(this.key(tenantId, actorId, id), JSON.stringify(stored), 'EX', TTL_SECONDS);
    await client.zadd(this.index(tenantId, actorId), Date.now(), id);
    await client.expire(this.index(tenantId, actorId), TTL_SECONDS);
    return stored;
  }

  async listTemplates(tenantId: string, actorId: string): Promise<StoredTemplateDraft[]> {
    const client = this.redis.client();
    if (!client) return [];
    const ids = await client.zrevrange(this.index(tenantId, actorId), 0, MAX_LIST - 1);
    if (!ids.length) return [];
    const raws = await client.mget(...ids.map((id) => this.key(tenantId, actorId, id)));
    return raws
      .filter((r): r is string => typeof r === 'string')
      .map((r) => JSON.parse(r) as StoredTemplateDraft)
      // Defensa en profundidad: aunque la clave ya lleva tenant y autor, se vuelve a comprobar.
      .filter((d) => d.tenantId === tenantId && d.actorId === actorId);
  }
}
