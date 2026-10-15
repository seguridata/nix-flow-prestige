import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { assertAudience } from '../auth/jwt-auth.guard';

const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const issuer = process.env.KEYCLOAK_ISSUER;
const jwks = issuer
  ? createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`))
  : undefined;

interface SocketUser {
  actorId: string;
  name?: string;
  tenantId: string;
}

export type DocumentEventType = 'SIGNATURE_APPLIED' | 'REQUEST_COMPLETED' | 'DOCUMENT_VIEWED';

export interface DocumentEvent {
  type: DocumentEventType;
  documentId: string;
  actorId: string;
  actorName?: string;
  at: string;
}

interface PresenceEntry {
  actorName: string;
  since: string;
}

interface PresenceActor {
  actorId: string;
  actorName: string;
  since: string;
}

export const PRESENCE_TTL_SECONDS = 60;
const PRESENCE_HEARTBEAT_MS = 20_000;
/** Un campo sin latido en este tiempo (réplica caída) se considera ausente. */
const PRESENCE_STALE_MS = 90_000;

export function presenceKey(tenantId: string, documentId: string) {
  return `presence:${tenantId}:${documentId}`;
}

function roomFor(documentId: string) {
  return `document:${documentId}`;
}

/**
 * Presencia y notificaciones en tiempo real (M-realtime). La presencia es
 * efímera: con Redis vive en un hash `presence:{tenantId}:{documentId}`
 * (campo = actorId) con TTL de ~60 s que renueva un latido, así todas las
 * réplicas ven la misma lista. Sin Redis (o si falla) se degrada al Map en
 * memoria del proceso (vista por instancia). El contrato de eventos al
 * cliente (`presence-update`, `document-event`) no cambia.
 */
@WebSocketGateway({
  cors: {
    origin: corsOrigins,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * D10 — con `REDIS_URL`, el servidor Socket.IO usa el adaptador Redis: las
   * salas y los `emit` se propagan entre réplicas del BFF. Sin Redis, cada
   * instancia funciona aislada (suficiente en single-node).
   */
  afterInit(server: Server): void {
    const pub = this.redis.duplicate();
    const sub = this.redis.duplicate();
    if (!pub || !sub) return;
    // Solo se instala el adaptador si Redis responde; si no, se degrada a memoria
    // (por instancia) en lugar de dejar suscripciones/publicaciones rechazadas.
    void this.installRedisAdapter(server, pub, sub);
  }

  private async installRedisAdapter(
    server: Server,
    pub: Parameters<typeof createAdapter>[0],
    sub: Parameters<typeof createAdapter>[1],
  ): Promise<void> {
    const attempts = 5;
    for (let i = 1; i <= attempts; i++) {
      try {
        await Promise.all([pub.ping(), sub.ping()]);
        server.adapter(createAdapter(pub, sub));
        this.logger.log('Socket.IO usando el adaptador Redis (multi-réplica)');
        return;
      } catch (err) {
        this.logger.warn(`Redis no responde para el adaptador Socket.IO (${i}/${attempts}): ${(err as Error).message}`);
        if (i < attempts) await new Promise((r) => setTimeout(r, 1000));
      }
    }
    this.logger.warn('Socket.IO sigue en modo memoria por instancia (sin adaptador Redis)');
  }

  private heartbeat: ReturnType<typeof setInterval> | null = null;

  /** Latido: renueva TTL y marca de tiempo de los miembros de ESTA réplica. */
  private startHeartbeat() {
    if (this.heartbeat || !this.redis.enabled) return;
    this.heartbeat = setInterval(() => void this.refreshPresence(), PRESENCE_HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  onModuleDestroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  async refreshPresence(): Promise<void> {
    const c = this.redis.client();
    if (!c) return;
    try {
      const pipe = c.pipeline();
      const now = new Date().toISOString();
      for (const [socketId, docs] of this.socketMemberships) {
        const tenantId = this.socketUsers.get(socketId)?.tenantId;
        if (!tenantId) continue;
        for (const [documentId, actorId] of docs) {
          const entry = this.presence.get(documentId)?.get(actorId);
          if (!entry) continue;
          const key = presenceKey(tenantId, documentId);
          pipe.hset(key, actorId, JSON.stringify({ ...entry, at: now }));
          pipe.expire(key, PRESENCE_TTL_SECONDS);
        }
      }
      await pipe.exec();
    } catch (e) {
      this.logger.debug(`latido de presencia falló: ${(e as Error).message}`);
    }
  }

  /** Registra al actor; devuelve true si ya estaba presente. */
  private async presenceAdd(tenantId: string, documentId: string, actorId: string, entry: PresenceEntry) {
    const byDocument = this.presence.get(documentId) ?? new Map<string, PresenceEntry>();
    let already = byDocument.has(actorId);
    byDocument.set(actorId, entry);
    this.presence.set(documentId, byDocument);
    const c = this.redis.client();
    if (!c) return already;
    try {
      const key = presenceKey(tenantId, documentId);
      const prev = await c.hexists(key, actorId);
      already = already || prev === 1;
      await c
        .pipeline()
        .hset(key, actorId, JSON.stringify({ ...entry, at: new Date().toISOString() }))
        .expire(key, PRESENCE_TTL_SECONDS)
        .exec();
    } catch (e) {
      this.logger.warn(`presencia en Redis no disponible, uso memoria: ${(e as Error).message}`);
    }
    return already;
  }

  private async presenceDrop(tenantId: string, documentId: string, actorId: string) {
    this.removePresence(documentId, actorId);
    const c = this.redis.client();
    if (!c) return;
    try {
      await c.hdel(presenceKey(tenantId, documentId), actorId);
    } catch (e) {
      this.logger.warn(`presencia en Redis no disponible: ${(e as Error).message}`);
    }
  }

  /** Lista de presentes: Redis si responde (descarta campos sin latido reciente); si no, el Map local. */
  private async presenceList(tenantId: string, documentId: string): Promise<PresenceActor[]> {
    const c = this.redis.client();
    if (c) {
      try {
        const all = await c.hgetall(presenceKey(tenantId, documentId));
        const cutoff = Date.now() - PRESENCE_STALE_MS;
        const actors: PresenceActor[] = [];
        for (const [actorId, raw] of Object.entries(all)) {
          try {
            const e = JSON.parse(raw) as PresenceEntry & { at?: string };
            if (e.at && Date.parse(e.at) < cutoff) continue;
            actors.push({ actorId, actorName: e.actorName, since: e.since });
          } catch {
            /* campo corrupto: se ignora */
          }
        }
        return actors.sort((a, b) => a.since.localeCompare(b.since) || a.actorId.localeCompare(b.actorId));
      } catch (e) {
        this.logger.warn(`presencia en Redis no disponible, uso memoria: ${(e as Error).message}`);
      }
    }
    const byDocument = this.presence.get(documentId);
    return byDocument
      ? Array.from(byDocument.entries()).map(([actorId, entry]) => ({
          actorId,
          actorName: entry.actorName,
          since: entry.since,
        }))
      : [];
  }

  // documentId -> (actorId -> presence info). Respaldo local (y fuente del latido de esta réplica).
  private readonly presence = new Map<string, Map<string, PresenceEntry>>();

  // socketId -> (documentId -> actorId), para poder limpiar todo al desconectar.
  private readonly socketMemberships = new Map<string, Map<string, string>>();

  // socketId -> usuario autenticado del handshake
  private readonly socketUsers = new Map<string, SocketUser>();

  /**
   * Autentica el handshake: el cliente envía el access token en
   * `handshake.auth.token` (o `Authorization: Bearer`). Sin token válido se
   * rechaza la conexión.
   */
  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!token || !jwks || !issuer) throw new Error('token ausente o issuer no configurado');
      const { payload } = await jwtVerify(token, jwks, { issuer });
      assertAudience(payload as { aud?: string | string[]; azp?: string });
      // Sin claim `tenant` no hay aislamiento posible: se rechaza (sin default).
      const tenantId = typeof payload.tenant === 'string' ? payload.tenant.trim() : '';
      if (!tenantId) throw new Error('token sin claim tenant');
      this.socketUsers.set(client.id, {
        actorId: (payload.preferred_username as string) ?? payload.sub ?? '',
        name: payload.name as string | undefined,
        tenantId,
      });
      this.socketMemberships.set(client.id, new Map());
    } catch (err) {
      this.logger.debug(`WS handshake rechazado: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const memberships = this.socketMemberships.get(client.id);
    const tenantId = this.socketUsers.get(client.id)?.tenantId;
    this.socketMemberships.delete(client.id);
    this.socketUsers.delete(client.id);
    if (!memberships || !tenantId) return;

    for (const [documentId, actorId] of memberships) {
      await this.presenceDrop(tenantId, documentId, actorId);
      await this.broadcastPresence(tenantId, documentId);
    }
  }

  @SubscribeMessage('join-document')
  async handleJoinDocument(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { documentId: string },
  ) {
    const documentId = body?.documentId;
    const user = this.socketUsers.get(client.id);
    // La identidad sale del handshake autenticado, nunca del payload del mensaje.
    if (typeof documentId !== 'string' || !documentId || !user) return;
    // El documento debe ser del tenant del socket; si no, se rechaza sin unirse.
    if (!(await this.canJoin(documentId, user.tenantId))) {
      this.logger.debug(`join-document rechazado: ${documentId} fuera del tenant`);
      return { ok: false, error: 'not-found' };
    }
    const actorId = user.actorId;
    const actorName = user.name ?? actorId;

    client.join(roomFor(documentId));

    const alreadyPresent = await this.presenceAdd(user.tenantId, documentId, actorId, {
      actorName: actorName ?? actorId,
      since: new Date().toISOString(),
    });
    this.startHeartbeat();

    const memberships = this.socketMemberships.get(client.id) ?? new Map<string, string>();
    memberships.set(documentId, actorId);
    this.socketMemberships.set(client.id, memberships);

    // Solo se anuncia como "vista" la primera vez que este actor entra a la
    // sala: reconexiones del mismo socket no deben inundar de toasts.
    if (!alreadyPresent) {
      this.notifyDocumentEvent(documentId, {
        type: 'DOCUMENT_VIEWED',
        actorId,
        actorName,
        at: new Date().toISOString(),
      });
    }

    await this.broadcastPresence(user.tenantId, documentId);
    return { ok: true };
  }

  /** true si el documento existe y pertenece al tenant. Falla cerrado ante errores. */
  private async canJoin(documentId: string, tenantId: string): Promise<boolean> {
    try {
      const doc = await this.prisma.document.findFirst({
        where: { id: documentId, tenantId },
        select: { id: true },
      });
      return Boolean(doc);
    } catch {
      return false;
    }
  }

  @SubscribeMessage('leave-document')
  async handleLeaveDocument(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { documentId: string },
  ) {
    const documentId = body?.documentId;
    const user = this.socketUsers.get(client.id);
    if (!documentId || !user) return;

    client.leave(roomFor(documentId));
    await this.presenceDrop(user.tenantId, documentId, user.actorId);
    this.socketMemberships.get(client.id)?.delete(documentId);

    await this.broadcastPresence(user.tenantId, documentId);
  }

  /**
   * Punto de entrada para que otros servicios (p. ej. SignatureRequestsService
   * tras un `sign()` exitoso) notifiquen a todos los presentes en un
   * documento. No depende de sockets conectados: si nadie está en la sala,
   * simplemente no llega a nadie.
   */
  notifyDocumentEvent(documentId: string, event: Omit<DocumentEvent, 'documentId'>) {
    const payload: DocumentEvent = { ...event, documentId };
    this.server?.to(roomFor(documentId)).emit('document-event', payload);
    this.logger.debug(`document-event ${payload.type} -> ${documentId}`);
  }

  private removePresence(documentId: string, actorId: string) {
    const byDocument = this.presence.get(documentId);
    if (!byDocument) return;
    byDocument.delete(actorId);
    if (byDocument.size === 0) this.presence.delete(documentId);
  }

  private async broadcastPresence(tenantId: string, documentId: string) {
    const actors = await this.presenceList(tenantId, documentId);
    this.server?.to(roomFor(documentId)).emit('presence-update', { documentId, actors });
  }
}
