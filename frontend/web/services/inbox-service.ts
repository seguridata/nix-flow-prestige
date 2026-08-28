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
