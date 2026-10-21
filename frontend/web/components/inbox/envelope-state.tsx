import { Ban, CircleAlert, CircleCheck, CircleX, Clock, TimerOff, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/libs/utils";

type BadgeTone = "success" | "warning" | "pending" | "destructive" | "neutral";

const STATES: Record<string, { label: string; tone: BadgeTone; icon: LucideIcon }> = {
  action: { label: "Requiere tu acción", tone: "warning", icon: CircleAlert },
  PENDIENTE: { label: "En curso", tone: "pending", icon: Clock },
  EN_FIRMA: { label: "En curso", tone: "pending", icon: Clock },
  COMPLETADA: { label: "Completado", tone: "success", icon: CircleCheck },
  RECHAZADA: { label: "Rechazado", tone: "destructive", icon: CircleX },
  CANCELADA: { label: "Cancelado", tone: "neutral", icon: Ban },
  EXPIRADA: { label: "Vencido", tone: "neutral", icon: TimerOff },
};

/**
 * Estado del sobre con icono y texto: nunca depende solo del color.
 * `actionable` (me toca firmar) tiene prioridad sobre el estado del sobre.
 */
export function EnvelopeState({
  status,
  actionable = false,
  className,
}: {
  status: string;
  actionable?: boolean;
  className?: string;
}) {
  const entry = STATES[actionable ? "action" : status] ?? { label: status, tone: "neutral" as const, icon: Clock };
  const Icon = entry.icon;
  return (
    <Badge variant={entry.tone} className={cn(actionable && "font-semibold", className)}>
      <Icon className="size-3.5" aria-hidden />
      {entry.label}
    </Badge>
  );
}
