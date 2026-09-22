import { apiClient } from "./api-client";
import type { CaseRecord } from "@/libs/types";

/** El tenant sale del token en el BFF; el cliente solo manda el título. */
export function createCase(body: { title: string }) {
  return apiClient.post<CaseRecord>("/cases", body);
}
