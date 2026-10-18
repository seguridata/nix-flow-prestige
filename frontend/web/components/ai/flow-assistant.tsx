"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { FindingsList } from "@/components/ai/findings-list";
import { Button } from "@/components/ui/button";
import { describeFindings } from "@/libs/ai-findings";
import { describeWhen, describeWho, type Flow } from "@/libs/flow";
import { proposeFlowFromText, reviewFlowWithAi, type AiFinding, type FlowProposal } from "@/services/ai-service";

const MIN = 20;
const MAX = 8000;

const textareaClass =
  "flex min-h-28 w-full rounded-md border border-input bg-background px-3.5 py-2.5 text-sm text-foreground shadow-subtle transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Asistente de IA para flujos: arma un flujo desde una descripción y revisa el que se está editando.
 * La IA solo propone: al usar la propuesta se carga en el editor y se guarda con el botón de siempre.
 */
export function FlowAssistant({ flow, onUse }: { flow: Flow; onUse: (flow: Flow) => void }) {
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<FlowProposal | null>(null);
  const [useAi, setUseAi] = useState(false);
  const [review, setReview] = useState<{ findings: AiFinding[]; ai: boolean } | null>(null);

  const propose = useMutation({
    mutationFn: () => proposeFlowFromText(text),
    onSuccess: (p) => {
      setProposal(p);
      if (!p.flow) toast.error("La IA no logró un flujo válido. Revisa los motivos y ajusta la descripción.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const check = useMutation({
    mutationFn: () => reviewFlowWithAi(flow, useAi),
    onSuccess: setReview,
    onError: (e: Error) => toast.error(e.message),
  });

  const len = text.trim().length;

  return (
    <section aria-labelledby="fa-titulo" className="space-y-5 rounded-xl border border-border p-4">
      <div>
        <h2 id="fa-titulo" className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden /> Asistente de IA
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Describe el proceso y la IA propone el flujo. Tú lo revisas y lo guardas como siempre; nada se publica solo.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="fa-texto" className="block text-sm font-medium">
          ¿Cómo se firma este documento?
        </label>
        <textarea
          id="fa-texto"
          className={textareaClass}
          value={text}
          maxLength={MAX}
          placeholder="Ej. Solicitud de gasto: firma quien la pide, aprueba su jefe y, si pasa de 50 mil pesos, también finanzas."
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" disabled={len < MIN || propose.isPending} onClick={() => propose.mutate()}>
            {propose.isPending ? "Pensando…" : "Proponer flujo"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {len < MIN ? `Escribe al menos ${MIN} caracteres (${len}).` : "Los datos personales se ocultan antes de enviarse."}
          </span>
        </div>
      </div>

      <div aria-live="polite">
        {proposal?.flow ? (
          <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
            <h3 className="text-sm font-semibold">Propuesta: {proposal.flow.steps.length} {proposal.flow.steps.length === 1 ? "paso" : "pasos"}</h3>
            <ol className="space-y-1 text-sm">
              {proposal.flow.steps.map((s, i) => (
                <li key={s.id}>
                  <span className="font-medium">{i + 1}. {s.label}</span>{" "}
                  <span className="text-muted-foreground">
                    {s.role === "REVISOR" ? "Revisa" : "Firma"}: {describeWho(s.who)}
                    {s.when?.length ? ` · ${describeWhen(s.when, proposal.flow!.variables)}` : ""}
                  </span>
                </li>
              ))}
            </ol>
            {proposal.warnings.map((w) => (
              <p key={w} className="text-xs text-muted-foreground">{w}</p>
            ))}
            {proposal.review.length ? <FindingsList findings={proposal.review} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onUse(proposal.flow!);
                  setProposal(null);
                  setReview(null);
                  toast.success("Propuesta cargada. Revísala y guárdala cuando estés conforme.");
                }}
              >
                Usar esta propuesta
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setProposal(null)}>
                Descartar
              </Button>
            </div>
          </div>
        ) : proposal ? (
          <div role="alert" className="space-y-1 rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">No se pudo armar un flujo válido</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {proposal.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="outline" disabled={flow.steps.length === 0 || check.isPending} onClick={() => check.mutate()}>
            <ShieldCheck /> {check.isPending ? "Revisando…" : "Revisar este flujo"}
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            Incluir la opinión de la IA
          </label>
        </div>
        <div aria-live="polite">
          {review ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{describeFindings(review.findings)}</p>
              {review.findings.length ? <FindingsList findings={review.findings} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
