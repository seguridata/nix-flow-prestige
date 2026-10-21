"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

import { HashChip } from "@/components/evidence/hash-chip";
import { Button } from "@/components/ui/button";
import { OFFLINE_VERIFY_COMMAND, custodyLabel } from "@/libs/evidence-checks";
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
 * sin conexión con Node.
 */
export function DossierCard({ manifestId }: { manifestId: string }) {
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

      <div>
        <Button asChild size="lg" className="w-full">
          <a href={evidenceDossierUrl(manifestId)} download>
            <Download /> Descargar expediente (ZIP)
          </a>
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Incluye el manifiesto firmado, el PDF congelado, la copia firmada, el sello de tiempo, los certificados y el
          verificador.
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">Dentro del ZIP, en una terminal:</p>
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
          <code className="min-w-0 flex-1 break-words font-mono text-xs">{OFFLINE_VERIFY_COMMAND}</code>
          <button
            type="button"
            onClick={copy}
            aria-label="Copiar comando"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            <span aria-live="polite">{copied ? "Copiado" : "Copiar"}</span>
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">Requiere Node.js. El LEEME.txt del ZIP explica cada comprobación.</p>
      </div>
    </section>
  );
}

/**
 * Cadena de custodia en lenguaje llano: quién hizo qué y cuándo, con la huella del documento después de
 * cada paso para poder cotejarla. Cada eslabón se apoya en el anterior.
 */
export function CustodyTimeline({
  custody,
  nameOf,
}: {
  custody: CustodyEvent[];
  nameOf: (actorId: string) => string;
}) {
  if (custody.length === 0) return null;
  return (
    <section aria-label="Cadena de custodia">
      <h2 className="text-lg font-semibold">Cadena de custodia</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Cada paso quedó encadenado con el anterior mediante la huella del documento.
      </p>
      <ol className="mt-4">
        {custody.map((e, i) => {
          const who = nameOf(e.actorId);
          return (
            <li key={`${e.at}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
              {i < custody.length - 1 ? <span aria-hidden className="absolute left-[10px] top-6 h-full w-px bg-border" /> : null}
              <span
                aria-hidden
                className="relative z-10 mt-0.5 flex size-[21px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <Check className="size-3.5" strokeWidth={3.5} />
              </span>
              <div className="min-w-0">
                <p className="text-base font-medium">
                  {e.action === "SIGNATURE_APPLIED" ? `${who} firmó el documento` : `${custodyLabel(e.action)}: ${who}`}
                </p>
                <p className="text-sm tabular-nums text-muted-foreground">{when.format(new Date(e.at))}</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  Huella tras este paso
                  <HashChip value={e.hashAfter} head={6} tail={4} label="huella de este paso" />
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
