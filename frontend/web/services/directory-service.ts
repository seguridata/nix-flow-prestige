import { apiClient } from "./api-client";
import type { Colleague } from "@/libs/types";

/**
 * Directorio del tenant (usuarios registrados) para el autocompletado de
 * firmantes. Degradación silenciosa: si falla, el wizard sigue funcionando
 * con inputs de texto libres.
 */
export function fetchColleagues() {
  return apiClient.get<Colleague[]>("/me/colleagues");
}
