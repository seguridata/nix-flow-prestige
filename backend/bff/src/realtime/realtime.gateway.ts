import { Logger } from '@nestjs/common';
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

function roomFor(documentId: string) {
  return `document:${documentId}`;
}

/**
 * Presencia y notificaciones en tiempo real (M-realtime). La presencia es
 * puramente efímera (vive solo en memoria del proceso): si el BFF se
 * reinicia o corre en múltiples réplicas, cada instancia tiene su propia
 * vista — suficiente para el propósito de "quién está viendo esto ahora
 * mismo" pero no una fuente de verdad persistente.
 */
@WebSocketGateway({
  cors: {
    origin: corsOrigins,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
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
    if (pub && sub) {
      server.adapter(createAdapter(pub, sub));
      this.logger.log('Socket.IO usando el adaptador Redis (multi-réplica)');
    }
  }

  // documentId -> (actorId -> presence info)
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

  handleDisconnect(client: Socket) {
    const memberships = this.socketMemberships.get(client.id);
    this.socketMemberships.delete(client.id);
    this.socketUsers.delete(client.id);
    if (!memberships) return;

    for (const [documentId, actorId] of memberships) {
      this.removePresence(documentId, actorId);
      this.broadcastPresence(documentId);
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

    const byDocument = this.presence.get(documentId) ?? new Map<string, PresenceEntry>();
    const alreadyPresent = byDocument.has(actorId);
    byDocument.set(actorId, { actorName: actorName ?? actorId, since: new Date().toISOString() });
    this.presence.set(documentId, byDocument);

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

    this.broadcastPresence(documentId);
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
  handleLeaveDocument(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { documentId: string },
  ) {
    const documentId = body?.documentId;
    const actorId = this.socketUsers.get(client.id)?.actorId;
    if (!documentId || !actorId) return;

    client.leave(roomFor(documentId));
    this.removePresence(documentId, actorId);
    this.socketMemberships.get(client.id)?.delete(documentId);

    this.broadcastPresence(documentId);
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

  private broadcastPresence(documentId: string) {
    const byDocument = this.presence.get(documentId);
    const actors = byDocument
      ? Array.from(byDocument.entries()).map(([actorId, entry]) => ({
          actorId,
          actorName: entry.actorName,
          since: entry.since,
        }))
      : [];
    this.server?.to(roomFor(documentId)).emit('presence-update', { documentId, actors });
  }
}
