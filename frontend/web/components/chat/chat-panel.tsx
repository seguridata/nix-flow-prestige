"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, MessageSquareText, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { describeWhen, describeWho } from "@/libs/flow";
import { saveChatDraft, sendChatMessage, type ChatProposal, type ChatTurn, type SavedDraft } from "@/services/chat-service";

export const AI_NOTICE = "Borrador generado por IA; requiere revisión humana";

const MAX = 2000;
const newConversationId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));

interface Entry {
  turn: ChatTurn;
  proposals?: ChatProposal[];
  notes?: string[];
}

/** Etiqueta visible (texto + icono, no solo color) de todo lo que genera la IA. */
export function AiDraftLabel() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
      <Sparkles className="size-3.5" aria-hidden /> {AI_NOTICE}
    </span>
  );
}

function ProposalCard({ p, conversationId }: { p: ChatProposal; conversationId: string }) {
  const [saved, setSaved] = useState<SavedDraft | null>(null);
  const save = useMutation({
    mutationFn: () => saveChatDraft(p, conversationId),
    onSuccess: (d) => {
      setSaved(d);
      toast.success("Guardado como borrador. Revísalo antes de publicar.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const kind = p.kind === "flow" ? "Flujo" : "Formato (sin PDF)";

  return (
    <article className="space-y-2 rounded-lg border border-border bg-background p-3" aria-label={`Propuesta: ${p.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">{kind}</span>
        <h3 className="text-sm font-semibold">{p.name}</h3>
      </div>
      <AiDraftLabel />
      {p.description ? <p className="text-xs text-muted-foreground">{p.description}</p> : null}
      <ol className="space-y-1 text-sm">
        {p.flow.steps.map((s, i) => (
          <li key={s.id}>
            <span className="font-medium">
              {i + 1}. {s.label}
            </span>{" "}
            <span className="text-muted-foreground">
              {s.role === "REVISOR" ? "Revisa" : "Firma"}: {describeWho(s.who)}
              {s.when?.length ? ` · ${describeWhen(s.when, p.flow.variables)}` : ""}
            </span>
          </li>
        ))}
      </ol>
      {p.kind === "template" ? (
        <p className="text-xs text-muted-foreground">El PDF base y la posición de los campos se agregan después, en Formatos.</p>
      ) : null}
      {saved ? (
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium">
          <CheckCircle2 className="size-4" aria-hidden /> Borrador guardado (sin publicar)
          {saved.key ? ` · ${saved.key} v${saved.version}` : ""}
        </p>
      ) : (
        <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando…" : "Guardar como borrador"}
        </Button>
      )}
    </article>
  );
}

const inputClass =
  "flex min-h-11 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

/**
 * Chat interno de IA en un panel lateral. Solo propone borradores; guardarlos y publicarlos es decisión de una persona.
 * Se muestra a administradores (el BFF exige el rol `admin`).
 */
export function ChatPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [conversationId] = useState(newConversationId);
  const endRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: (message: string) => sendChatMessage(message, entries.map((e) => e.turn), conversationId),
    onSuccess: (r) =>
      setEntries((prev) => [
        ...prev,
        { turn: { role: "assistant", content: r.reply }, proposals: r.proposals, notes: [...r.warnings, ...r.rejected] },
      ]),
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [entries.length, send.isPending]);

  const submit = () => {
    const message = text.trim();
    if (!message || send.isPending) return;
    setEntries((prev) => [...prev, { turn: { role: "user", content: message } }]);
    setText("");
    send.mutate(message);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          className="fixed bottom-5 right-5 z-40 h-12 rounded-full bg-primary px-5 text-brand-carbon shadow-elevated hover:bg-primary/90"
          aria-label="Abrir el asistente de IA"
        >
          <MessageSquareText aria-hidden /> Asistente
        </Button>
      </SheetTrigger>
      <SheetContent title="Asistente de IA">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold">Asistente de IA</h2>
            <AiDraftLabel />
            <p className="text-xs text-muted-foreground">Solo propone borradores. No publica, firma, envía ni borra nada.</p>
          </div>
          <SheetClose asChild>
            <Button type="button" variant="outline" size="sm">
              Cerrar
            </Button>
          </SheetClose>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-busy={send.isPending}>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ej.: «Arma un flujo de solicitud de gasto: firma quien la pide y, si pasa de 50 mil pesos, también finanzas.»
            </p>
          ) : null}
          {entries.map((e, i) => (
            <div key={i} className="space-y-2">
              <p className={e.turn.role === "user" ? "ml-8 rounded-lg bg-secondary p-2.5 text-sm text-secondary-foreground" : "mr-4 rounded-lg bg-muted p-2.5 text-sm"}>
                <span className="sr-only">{e.turn.role === "user" ? "Tú: " : "Asistente: "}</span>
                {e.turn.content}
              </p>
              {e.notes?.map((n) => (
                <p key={n} className="text-xs text-muted-foreground">
                  {n}
                </p>
              ))}
              {e.proposals?.map((p, j) => <ProposalCard key={j} p={p} conversationId={conversationId} />)}
            </div>
          ))}
          {send.isPending ? <p className="text-sm text-muted-foreground">Pensando…</p> : null}
          <div ref={endRef} />
        </div>

        <form
          className="space-y-2 border-t border-border p-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            submit();
          }}
        >
          <label htmlFor="chat-msg" className="sr-only">
            Mensaje para el asistente
          </label>
          <textarea
            id="chat-msg"
            className={inputClass}
            rows={2}
            value={text}
            maxLength={MAX}
            placeholder="Describe el flujo o formato que necesitas"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Los datos personales se ocultan antes de enviarse.</span>
            <Button type="submit" size="sm" disabled={!text.trim() || send.isPending}>
              <Send aria-hidden /> Enviar
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
