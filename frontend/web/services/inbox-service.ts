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

export function fetchInbox(_signerId: string) {
  return apiClient.get<InboxItem[]>("/me/inbox");
}

export function fetchSent(_requestedBy: string) {
  return apiClient.get<InboxItem[]>("/me/sent");
}

export interface InboxPage {
  items: InboxItem[];
  nextCursor: string | null;
}

export function fetchInboxPage(cursor?: string, signal?: AbortSignal) {
  return apiClient.get<InboxPage>(`/me/inbox?${pageQuery(cursor)}`, { signal });
}

export function fetchSentPage(cursor?: string, signal?: AbortSignal) {
  return apiClient.get<InboxPage>(`/me/sent?${pageQuery(cursor)}`, { signal });
}

function pageQuery(cursor?: string) {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

/** Preserve server order and remove overlapping requests after concurrent changes/refetches. */
export function mergeInboxPages(pages: readonly InboxPage[] = []): InboxItem[] {
  const rows = new Map<string, InboxItem>();
  for (const page of pages) for (const item of page.items) {
    if (!rows.has(item.signatureRequestId)) rows.set(item.signatureRequestId, item);
  }
  return [...rows.values()];
}

export function filterInboxItems(items: InboxItem[], criterion: string) {
  const term = criterion.trim().toLocaleLowerCase("es");
  return term ? items.filter(item => [item.documentTitle, item.caseTitle, item.requestedByName, item.status, ...(item.signers ?? []).map(s => s.name ?? s.signerId)]
    .join(" ").toLocaleLowerCase("es").includes(term)) : items;
}
