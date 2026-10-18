"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { proposeTemplateFromPdf, type TemplateProposal, type TemplateProposalMeta } from "@/services/ai-service";

/**
 * Propone campos, pasos y cajas de firma para el PDF elegido. Las posiciones salen de los campos de formulario
 * del propio PDF y al modelo no se le envía el contenido del documento. Nada se guarda: la propuesta se carga
 * en el editor y se guarda como borrador con el botón de siempre.
 */
export function FormatAiAssistant({ file, onApply }: { file: File; onApply: (meta: TemplateProposalMeta) => void }) {
  const [hint, setHint] = useState("");
  const [proposal, setProposal] = useState<TemplateProposal | null>(null);

  const run = useMutation({
    mutationFn: () => proposeTemplateFromPdf(file, hint),
    onSuccess: (p) => {
      setProposal(p);
      if (!p.meta) toast.error(p.errors[0] ?? "La IA no logró una propuesta válida.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden /> Proponer con IA
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Si el PDF tiene campos de formulario, la IA propone qué dato va en cada uno, los pasos de firma y quién firma dónde.
        </p>
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">¿De qué trata el documento? (opcional)</span>
        <Input value={hint} maxLength={2000} placeholder="Ej. Solicitud de vacaciones; el jefe aprueba y RH revisa si son más de 10 días" onChange={(e) => setHint(e.target.value)} />
      </label>
      <Button type="button" size="sm" disabled={run.isPending} onClick={() => run.mutate()}>
        {run.isPending ? "Analizando el PDF…" : "Proponer campos y pasos"}
      </Button>

      <div aria-live="polite">
        {proposal?.meta ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {proposal.meta.fields.length} {proposal.meta.fields.length === 1 ? "dato" : "datos"}, {proposal.meta.flow.steps.length}{" "}
              {proposal.meta.flow.steps.length === 1 ? "paso" : "pasos"} y {proposal.meta.signatureBoxes.length}{" "}
              {proposal.meta.signatureBoxes.length === 1 ? "caja de firma" : "cajas de firma"}.
            </p>
            {proposal.warnings.map((w) => (
              <p key={w} className="text-xs text-muted-foreground">{w}</p>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onApply(proposal.meta!);
                  setProposal(null);
                  toast.success("Propuesta cargada. Revisa cada dato en el PDF y guarda como borrador.");
                }}
              >
                Cargar en el editor
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setProposal(null)}>
                Descartar
              </Button>
            </div>
          </div>
        ) : proposal ? (
          <div role="alert" className="space-y-1 rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">No se pudo armar una propuesta</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {[...proposal.errors, ...proposal.warnings.filter((w) => !proposal.errors.includes(w))].map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
