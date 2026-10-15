import { apiClient } from "./api-client";
import type { Flow } from "@/libs/flow";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatProposal {
  kind: "flow" | "template";
  name: string;
  description: string | null;
  flow: Flow;
  status: "PROPUESTA";
}

export interface ChatReply {
  reply: string;
  proposals: ChatProposal[];
  rejected: string[];
  warnings: string[];
  notice: string;
  meta: { model: string | null };
}

export interface SavedDraft {
  kind: "flow" | "template";
  status: "BORRADOR";
  published: false;
  key?: string;
  version?: number;
  id?: string;
  name: string;
}

/** El historial lo guarda el navegador y se reenvía acotado; el servidor no guarda conversaciones. */
export const sendChatMessage = (message: string, history: ChatTurn[], conversationId: string) =>
  apiClient.post<ChatReply>("/chat/messages", { message, history: history.slice(-10), conversationId });

/** Guarda una propuesta como borrador. Nunca publica: publicar es una acción humana en Flujos o Formatos. */
export const saveChatDraft = (p: ChatProposal, conversationId: string) =>
  apiClient.post<SavedDraft>("/chat/drafts", {
    kind: p.kind,
    name: p.name,
    description: p.description ?? undefined,
    flow: p.flow,
    conversationId,
  });
