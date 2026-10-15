import { Badge } from "@/components/ui/badge";
import { SEVERITY_LABEL, sortFindings } from "@/libs/ai-findings";
import type { AiFinding } from "@/services/ai-service";

const VARIANT = { error: "destructive", warn: "warning", info: "neutral" } as const;

/** Lista de observaciones de un flujo. Distingue lo que se comprobó con reglas de lo que opina la IA. */
export function FindingsList({ findings }: { findings: readonly AiFinding[] }) {
  return (
    <ul className="space-y-2">
      {sortFindings(findings).map((f) => (
        <li key={f.id} className="rounded-lg border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={VARIANT[f.severity]}>{SEVERITY_LABEL[f.severity]}</Badge>
            <span className="text-xs text-muted-foreground">{f.source === "ia" ? "Opinión de la IA" : "Comprobado por el sistema"}</span>
          </div>
          <p className="mt-1.5 font-medium">{f.title}</p>
          {f.detail ? <p className="text-muted-foreground">{f.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}
