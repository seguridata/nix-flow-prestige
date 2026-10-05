"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";

import { useSession } from "@/store/session-store";
import type { PresenceState, RealtimeEvent } from "@/libs/types";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface PresenceUpdatePayload {
  documentId: string;
  actors: PresenceState[];
}

function describeEvent(event: RealtimeEvent, myActorId: string): string | null {
  if (event.actorId === myActorId) return null;
  const who = event.actorName ?? "Alguien";
  switch (event.type) {
    case "SIGNATURE_APPLIED":
      return `${who} firmó el documento.`;
    case "REQUEST_COMPLETED":
      return "El flujo de firma se completó.";
    case "DOCUMENT_VIEWED":
      return `${who} está viendo el documento.`;
    default:
      return null;
  }
}

/**
 * Presencia y notificaciones en vivo para un documento. El handshake de
 * Socket.IO se autentica con un access token de corta vida obtenido de
 * `/api/auth/session-token` (el WS no puede pasar por el proxy de route
 * handlers). La identidad la resuelve el gateway a partir de ese token.
 */
export function useDocumentRealtime(documentId: string | undefined) {
  const { signerId } = useSession();
  const [presentActors, setPresentActors] = useState<PresenceState[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!documentId) return;
    let disposed = false;
    let socket: Socket | null = null;

    (async () => {
      let token: string | undefined;
      try {
        const r = await fetch("/api/auth/session-token", { cache: "no-store" });
        if (r.ok) token = (await r.json()).token;
      } catch {
        /* sin token no hay presencia en vivo; el resto de la vista funciona */
      }
      if (disposed || !token) return;

      socket = io(SOCKET_URL, { transports: ["websocket"], auth: { token } });
      socketRef.current = socket;

      socket.on("connect", () => {
        setIsConnected(true);
        socket?.emit("join-document", { documentId });
      });
      socket.on("disconnect", () => setIsConnected(false));
      socket.on("presence-update", (payload: PresenceUpdatePayload) => {
        if (payload.documentId !== documentId) return;
        setPresentActors(payload.actors.filter((a) => a.actorId !== signerId));
      });
      socket.on("document-event", (event: RealtimeEvent) => {
        if (event.documentId !== documentId) return;
        const message = describeEvent(event, signerId);
        if (message) toast.info(message);
      });
    })();

    return () => {
      disposed = true;
      if (socket) {
        socket.emit("leave-document", { documentId });
        socket.disconnect();
      }
      socketRef.current = null;
      setIsConnected(false);
      setPresentActors([]);
    };
  }, [documentId, signerId]);

  return { presentActors, isConnected };
}
