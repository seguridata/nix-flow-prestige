import { apiClient } from "./api-client";
import type { CaseRecord } from "@/libs/types";

export function createCase(body: { tenantId: string; title: string }) {
  return apiClient.post<CaseRecord>("/cases", body);
}
