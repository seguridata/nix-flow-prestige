import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

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
    origin: 'http://localhost:3001',
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  // documentId -> (actorId -> presence info)
  private readonly presence = new Map<string, Map<string, PresenceEntry>>();

  // socketId -> (documentId -> actorId), para poder limpiar todo al desconectar.
  private readonly socketMemberships = new Map<string, Map<string, string>>();

  handleConnection(client: Socket) {
    this.socketMemberships.set(client.id, new Map());
  }

  handleDisconnect(client: Socket) {
    const memberships = this.socketMemberships.get(client.id);
    this.socketMemberships.delete(client.id);
    if (!memberships) return;

    for (const [documentId, actorId] of memberships) {
      this.removePresence(documentId, actorId);
      this.broadcastPresence(documentId);
    }
  }

  @SubscribeMessage('join-document')
  handleJoinDocument(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { documentId: string; actorId: string; actorName?: string },
  ) {
    const { documentId, actorId, actorName } = body ?? {};
    if (!documentId || !actorId) return;

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
  }

  @SubscribeMessage('leave-document')
  handleLeaveDocument(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { documentId: string; actorId: string },
  ) {
    const { documentId, actorId } = body ?? {};
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
