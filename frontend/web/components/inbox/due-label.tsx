import { Clock } from "lucide-react";

import { dueLabel, type DueTone } from "@/libs/overview";
import { cn } from "@/libs/utils";

const TONE: Record<DueTone, string> = {
  overdue: "font-semibold text-destructive",
  soon: "font-medium text-foreground",
  normal: "text-muted-foreground",
  none: "text-muted-foreground",
};

/** Vencimiento con icono y texto ("Hoy 14:00", "Vencido"). No dice nada si el sobre no vence. */
export function DueLabel({ expiresAt, className }: { expiresAt?: string | null; className?: string }) {
  if (!expiresAt) return null;
  const due = dueLabel(expiresAt);
  if (due.tone === "none") return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", TONE[due.tone], className)}>
      <Clock className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">Vence: </span>
      {due.text}
    </span>
  );
}
