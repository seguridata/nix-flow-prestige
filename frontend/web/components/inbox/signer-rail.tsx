import { Check, X } from "lucide-react";

import { signerLabel } from "@/libs/envelope-status";
import type { InboxItem } from "@/services/inbox-service";
import { cn } from "@/libs/utils";

type Signer = NonNullable<InboxItem["signers"]>[number];

const STATE_TEXT: Record<string, string> = {
  FIRMADO: "firmó",
  PENDIENTE: "pendiente",
  RECHAZADO: "rechazó",
};

/**
 * Riel de firmantes: un nodo por persona, unidos por una línea. El estado nunca depende solo del
 * color: el nodo cambia de forma (check, aro, cruz) y el texto lo dice.
 */
export function SignerRail({ signers, currentSignerId }: { signers: Signer[]; currentSignerId?: string }) {
  if (signers.length === 0) return null;
  return (
    <ol className="flex items-start" aria-label="Firmantes">
      {signers.map((s, i) => {
        const done = s.status === "FIRMADO";
        const rejected = s.status === "RECHAZADO";
        const turn = !done && !rejected && s.signerId === currentSignerId;
        return (
          <li key={s.signerId} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
            {i > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1/2 top-[11px] h-px w-full -translate-y-1/2",
                  signers[i - 1]?.status === "FIRMADO" ? "bg-primary" : "bg-border",
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex size-[22px] items-center justify-center rounded-full border",
                done && "border-primary bg-primary text-primary-foreground",
                rejected && "border-foreground bg-foreground text-background",
                !done && !rejected && "bg-background",
                !done && !rejected && (turn ? "border-foreground border-2" : "border-border"),
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}
              {rejected ? <X className="size-3.5" strokeWidth={3} aria-hidden /> : null}
            </span>
            <span className="mt-2 w-full truncate px-1 text-xs font-medium text-foreground">{signerLabel(s)}</span>
            <span className="text-xs text-muted-foreground">
              {turn ? "le toca ahora" : (STATE_TEXT[s.status] ?? s.status.toLowerCase())}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
