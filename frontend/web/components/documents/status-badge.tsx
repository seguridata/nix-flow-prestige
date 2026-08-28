import { Badge } from "@/components/ui/badge";
import type { SignatureRequestStatus, SignerStatus } from "@/libs/types";

const STATUS_MAP: Record<
  string,
  { label: string; variant: "success" | "warning" | "pending" | "destructive" | "neutral" }
> = {
  PENDIENTE: { label: "Pendiente de tu firma", variant: "warning" },
  EN_FIRMA: { label: "En progreso", variant: "pending" },
  COMPLETADA: { label: "Completado", variant: "success" },
  FIRMADO: { label: "Firmado", variant: "success" },
  RECHAZADA: { label: "Rechazado", variant: "destructive" },
  RECHAZADO: { label: "Rechazado", variant: "destructive" },
  EXPIRADA: { label: "Expirado", variant: "neutral" },
  BORRADOR: { label: "Borrador", variant: "neutral" },
  DATOS: { label: "Datos capturados", variant: "pending" },
  INE: { label: "INE cargada", variant: "pending" },
  PRUEBA_VIDA: { label: "Prueba de vida", variant: "warning" },
  EN_REVISION: { label: "En verificación", variant: "warning" },
  HABILITADO: { label: "Habilitado", variant: "success" },
  CREADA: { label: "Creada", variant: "pending" },
  ASIGNADA: { label: "Asignada", variant: "warning" },
  COMPLETADA_TAREA: { label: "Completada", variant: "success" },
  CANCELADA: { label: "Cancelada", variant: "neutral" },
};

export function StatusBadge({
  status,
}: {
  status: SignatureRequestStatus | SignerStatus | string;
}) {
  const entry = STATUS_MAP[status] ?? { label: status, variant: "neutral" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
