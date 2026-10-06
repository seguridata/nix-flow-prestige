"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OFFLINE_VERIFY_COMMAND, custodyLabel } from "@/libs/evidence-checks";
import { shortHash } from "@/libs/envelope-status";
import { evidenceDossierUrl } from "@/services/evidence-service";

export interface CustodyEvent {
  action: string;
  actorId: string;
  at: string;
  hashAfter: string;
}

const when = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * "Comprueba sin confiar en Prestige": el expediente en ZIP lleva su propio verificador, que corre
 * sin conexión con Node. La cadena de custodia muestra el hash de cada eslabón para cotejarlo.
 */
export function DossierCard({
  manifestId,
  custody,
  nameOf,
}: {
  manifestId: string;
  custody: CustodyEvent[];
  nameOf: (actorId: string) => string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(OFFLINE_VERIFY_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* El portapapeles puede estar bloqueado: el comando sigue visible para copiarlo a mano. */
    }
  }

  return (
    <section aria-label="Comprobación independiente" className="space-y-5 rounded-lg border border-border bg-background p-5">
      <div>
        <h2 className="text-lg font-semibold leading-tight">Comprueba sin confiar en Prestige</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          El expediente trae su propio verificador: corre en tu computadora, sin conexión.
        </p>
      </div>

      <Button asChild className="w-full">
        <a href={evidenceDossierUrl(manifestId)} download>
          <Download /> Descargar expediente (ZIP)
        </a>
      </Button>

      <div>
        <p className="mb-1.5 text-sm font-medium">Dentro del ZIP, en una terminal:</p>
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
          <code className="min-w-0 flex-1 break-words font-mono text-xs">{OFFLINE_VERIFY_COMMAND}</code>
          <button
            type="button"
            onClick={copy}
            aria-label="Copiar comando"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">Requiere Node.js. El LEEME.txt del ZIP explica cada comprobación.</p>
      </div>

      {custody.length > 0 ? (
        <div className="border-t border-border pt-4">
          <h3 className="text-base font-semibold">Cadena de custodia</h3>
          <ol className="mt-3">
            {custody.map((e, i) => (
              <li key={`${e.at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
                {i < custody.length - 1 ? <span aria-hidden className="absolute left-[8px] top-5 h-full w-px bg-border" /> : null}
                <span aria-hidden className="relative z-10 mt-1 flex size-[17px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" strokeWidth={3.5} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {custodyLabel(e.action)} · {nameOf(e.actorId)}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">{when.format(new Date(e.at))}</p>
                  <code className="mt-1 inline-block rounded bg-muted px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground" title={e.hashAfter}>
                    {shortHash(e.hashAfter, 6, 4)}
                  </code>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
