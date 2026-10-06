import { apiClient } from "./api-client";

export interface InboxItem {
  signatureRequestId: string;
  documentId: string;
  documentTitle: string;
  caseTitle: string;
  requestedByName: string;
  status: string;
  myStatus: string;
  methods: string[];
  createdAt: string;
  pendingSigners?: string[];
  signers?: { signerId: string; name?: string | null; status: string }[];
  /** SECUENCIAL | PARALELO. */
  order?: string;
  /** SECUENCIAL: a quién le toca firmar ahora. */
  currentSignerId?: string;
  /** ¿Puede firmar ya el dueño de esta bandeja? (false = espera su turno) */
  myTurn?: boolean;
  /** Vencimiento de la solicitud (ISO), o null si no tiene. */
  expiresAt?: string | null;
}

export function fetchInbox(signerId: string) {
  return apiClient.get<InboxItem[]>(
    `/me/inbox?signerId=${encodeURIComponent(signerId)}`,
  );
}

export function fetchSent(requestedBy: string) {
  return apiClient.get<InboxItem[]>(
    `/me/sent?requestedBy=${encodeURIComponent(requestedBy)}`,
  );
}
