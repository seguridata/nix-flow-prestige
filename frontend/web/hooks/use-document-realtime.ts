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
  if (event.actorId === myActorId) return null; // no notificamos nuestras propias acciones
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
 * Presencia y notificaciones en vivo para un documento (M-realtime).
 * Se conecta al gateway de Socket.IO del BFF mientras el componente que
 * llama a este hook esté montado; se desconecta limpiamente al salir.
 */
export function useDocumentRealtime(documentId: string | undefined) {
  const { signerId, name } = useSession();
  const [presentActors, setPresentActors] = useState<PresenceState[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!documentId) return;

    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    const join = () => {
      socket.emit("join-document", { documentId, actorId: signerId, actorName: name });
    };

    socket.on("connect", () => {
      setIsConnected(true);
      join();
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("presence-update", (payload: PresenceUpdatePayload) => {
      if (payload.documentId !== documentId) return;
      setPresentActors(payload.actors.filter((actor) => actor.actorId !== signerId));
    });

    socket.on("document-event", (event: RealtimeEvent) => {
      if (event.documentId !== documentId) return;
      const message = describeEvent(event, signerId);
      if (message) toast.info(message);
    });

    return () => {
      socket.emit("leave-document", { documentId, actorId: signerId });
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setPresentActors([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, signerId, name]);

  return { presentActors, isConnected };
}
