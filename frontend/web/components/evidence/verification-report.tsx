import { Check, Info, Minus, ShieldAlert, X } from "lucide-react";

import {
  TRUST_NOTE,
  checkRows,
  verdictOf,
  type CheckRow,
  type VerificationResult,
} from "@/libs/evidence-checks";
import { cn } from "@/libs/utils";

/** Marca de estado por forma (check, cruz, guion): el color solo refuerza, nunca informa solo. */
function StateMark({ state }: { state: CheckRow["state"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border",
        state === "pass" && "border-primary bg-primary text-primary-foreground",
        state === "fail" && "border-foreground bg-foreground text-background",
        state === "absent" && "border-border text-muted-foreground",
      )}
    >
      {state === "pass" ? <Check className="size-4" strokeWidth={3} /> : null}
      {state === "fail" ? <X className="size-4" strokeWidth={3} /> : null}
      {state === "absent" ? <Minus className="size-4" strokeWidth={2.5} /> : null}
    </span>
  );
}

const STATE_WORD = { pass: "Correcto", fail: "Falló", absent: "No aplica" } as const;

/**
 * Resultado del verificador del servidor: veredicto, una fila por comprobación que el servidor hizo
 * y la nota veraz sobre la CA interna. `detail` permite pegar a cada fila el dato que la respalda
 * (un hash, la fecha del sello) sin que este componente conozca el manifiesto.
 */
export function VerificationReport({
  result,
  checkedAt,
  detail = {},
}: {
  result: VerificationResult | null | undefined;
  checkedAt?: Date;
  detail?: Partial<Record<CheckRow["id"], React.ReactNode>>;
}) {
  const verdict = verdictOf(result);
  const rows = checkRows(result?.checks);
  const intact = verdict.kind === "intact";
  const failed = verdict.kind === "failed";

  return (
    <div className="space-y-5">
      <div
        role="status"
        className={cn(
          "flex items-start gap-4 rounded-lg border p-5",
          intact && "border-primary/60 bg-accent/60",
          failed && "border-2 border-foreground",
          verdict.kind === "checking" && "border-border bg-muted/40",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full",
            intact && "bg-primary text-primary-foreground",
            failed && "bg-foreground text-background",
            verdict.kind === "checking" && "bg-muted text-muted-foreground",
          )}
        >
          {intact ? <Check className="size-6" strokeWidth={3} /> : failed ? <ShieldAlert className="size-6" /> : <Info className="size-5" />}
        </span>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-tight text-balance">{verdict.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {verdict.detail}
            {checkedAt && result ? ` Verificado hoy a las ${checkedAt.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })}.` : ""}
          </p>
        </div>
      </div>

      {failed && result && result.mismatches.length > 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Diferencias que reportó el servidor</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {result.mismatches.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ul aria-label="Comprobaciones" className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-3.5 p-4">
              <StateMark state={row.state} />
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium">
                  {row.title}
                  <span className="sr-only"> — {STATE_WORD[row.state]}</span>
                </p>
                <p className="text-sm text-muted-foreground">{row.description}</p>
                {detail[row.id] ? <div className="mt-1.5">{detail[row.id]}</div> : null}
              </div>
              <span className="hidden shrink-0 text-sm text-muted-foreground sm:block">{STATE_WORD[row.state]}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="flex items-start gap-3 rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
        <span>{TRUST_NOTE}</span>
      </p>
    </div>
  );
}
