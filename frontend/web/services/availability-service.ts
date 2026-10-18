import { apiClient } from "./api-client";

export interface OutOfOffice {
  id: string;
  userId: string;
  delegateId: string;
  delegateName: string | null;
  reason: string | null;
  since: string;
  until: string | null;
}

export interface SetOutOfOfficeBody {
  delegateId: string;
  delegateName?: string;
  reason?: string;
  since?: string;
  until?: string;
}

export function fetchOutOfOffice() {
  return apiClient.get<OutOfOffice | null>("/me/out-of-office");
}

export function setOutOfOffice(body: SetOutOfOfficeBody) {
  return apiClient.put<OutOfOffice>("/me/out-of-office", body);
}

export function clearOutOfOffice() {
  return apiClient.delete<{ ok: true }>("/me/out-of-office");
}
