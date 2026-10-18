"use client";

import { use, useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import { toast } from "sonner";

import { AttachmentsBlock, useAttachments } from "@/components/formats/attachments-block";
import { type Person } from "@/components/formats/person-picker";
import { SendToSteps } from "@/components/formats/send-to-steps";
import { PdfSurface, useContainerWidth } from "@/components/formats/pdf-surface";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { attachmentErrorsFrom, unmetSpecs } from "@/libs/attachments";
import { type FlowVariable } from "@/libs/flow";
import { needsPerson } from "@/libs/format-steps";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";
import { ApiError } from "@/services/api-client";
import {
  fetchFormat,
  formatPdfUrl,
  instantiateFormat,
  previewFormatFlow,
  type AskedSigner,
  type FormatDetail,
  type ResolvedStep,
} from "@/services/formats-service";

const today = () => new Date().toISOString().slice(0, 10);
/** El PDF final imprime las fechas como DD/MM/AAAA; la vista previa debe verse igual. */
const shown = (type: string, v: string) => (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split("-").reverse().join("/") : v);

export default function UsarFormatoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const format = useQuery({ queryKey: ["format", id], queryFn: () => fetchFormat(id), retry: false });
  const { roles } = useSession();

  return (
    <AppShell
      title={format.data?.name ?? "Formato"}
      actions={
        roles.includes("admin") && format.data ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/formatos/${id}/editar` as never}>
              <Pencil /> Editar formato
            </Link>
          </Button>
        ) : undefined
      }
    >
      <Link href={"/formatos" as never} className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Todos los formatos
      </Link>
      {format.isLoading ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      ) : format.isError || !format.data ? (
        <p role="alert" className="text-sm">
          Este formato no existe o no está publicado.
        </p>
      ) : (
        <UsarForm format={format.data} />
      )}
    </AppShell>
  );
}

function UsarForm({ format }: { format: FormatDetail }) {
  const router = useRouter();
  const session = useSession();

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of format.fields) {
      if (f.prefill === "user.name") init[f.key] = session.name;
      if (f.prefill === "user.email") init[f.key] = session.email ?? "";
      if (f.prefill === "today") init[f.key] = today();
    }
    return init;
  });
  const [asked, setAsked] = useState<Record<string, Person>>({});

  const typed = useMemo(() => {
    const out: Record<string, string | number> = {};
    for (const v of format.flow.variables) {
      const raw = values[v.key];
      if (raw === undefined || raw === "") continue;
      out[v.key] = v.type === "number" ? Number(raw) : raw;
    }
    return out;
  }, [values, format.flow.variables]);

  const deferred = useDeferredValue(JSON.stringify(typed));
  const preview = useQuery({
    queryKey: ["flow-preview", format.id, deferred],
    queryFn: () => previewFormatFlow(format.id, JSON.parse(deferred)),
    placeholderData: (prev) => prev,
    retry: false,
  });

  const specs = format.attachmentSpecs ?? [];
  const att = useAttachments(format.id, specs);
  const [attachmentErrors, setAttachmentErrors] = useState<Record<string, string>>({});
  const pendingSpecs = unmetSpecs(specs, att.counts);

  const missing = format.flow.variables.filter((v) => v.required && !String(values[v.key] ?? "").trim());
  const activeAsk = (preview.data?.steps ?? []).filter((s) => s.active && needsPerson(s));
  const missingPeople = activeAsk.filter((s) => !asked[s.stepId]);
  const ready = missing.length === 0 && missingPeople.length === 0 && pendingSpecs.length === 0 && !att.uploading;

  const send = useMutation({
    mutationFn: () =>
      instantiateFormat(format.id, {
        values: typed,
        // Solo los pasos que de verdad se preguntan: los que resolvió la tabla no llevan askedSigners.
        askedSigners: Object.fromEntries(
          Object.entries(asked)
            .filter(([stepId]) => activeAsk.some((s) => s.stepId === stepId))
            .map(([k, p]) => [k, { signerId: p.signerId, name: p.name, email: p.email } satisfies AskedSigner]),
        ),
        ...(specs.length > 0 ? { attachments: att.staged() } : {}),
      }),
    onMutate: () => setAttachmentErrors({}),
    onSuccess: (r) => {
      toast.success("Enviado a firma.");
      router.push(`/documents/${r.documentId}` as never);
    },
    onError: (e: Error) => {
      // El servidor valida los anexos antes de crear nada: se muestra el error en el anexo que corresponde.
      const perSpec = e instanceof ApiError ? attachmentErrorsFrom(e.body) : {};
      if (Object.keys(perSpec).length > 0) {
        setAttachmentErrors(perSpec);
        toast.error("Revisa los anexos marcados.");
      } else toast.error(e.message || "No se pudo enviar.");
    },
  });

  const { ref, width } = useContainerWidth(560);
  const fontScale = width / 612;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !send.isPending) send.mutate();
        }}
      >
        {format.description ? <p className="text-sm text-muted-foreground">{format.description}</p> : null}

        <div className="space-y-4">
          {format.flow.variables.map((v) => (
            <Field key={v.key} variable={v} value={values[v.key] ?? ""} onChange={(val) => setValues((s) => ({ ...s, [v.key]: val }))} />
          ))}
          {format.flow.variables.length === 0 ? <p className="text-sm text-muted-foreground">Este formato no pide datos.</p> : null}
        </div>

        <AttachmentsBlock specs={specs} state={att} serverErrors={attachmentErrors} />

        <section aria-labelledby="se-envia" className="rounded-lg border border-border p-4" aria-busy={preview.isFetching}>
          <h2 id="se-envia" className="text-sm font-semibold">
            Se enviará a
          </h2>
          <SendToSteps
            steps={
              preview.data?.steps ??
              format.flow.steps.map((s): ResolvedStep => ({ stepId: s.id, label: s.label, role: s.role, who: s.who, active: !s.when?.length }))
            }
            asked={asked}
            onAsk={(stepId, p) =>
              setAsked((a) => {
                const n = { ...a };
                if (p) n[stepId] = p;
                else delete n[stepId];
                return n;
              })
            }
          />
          {preview.isError ? (
            <p role="alert" className="mt-3 text-sm text-[#8c2018]">
              No se pudo calcular a quién se enviará con estos datos. {preview.error instanceof Error ? preview.error.message : ""}
            </p>
          ) : null}
        </section>

        <div className="space-y-2">
          <Button type="submit" size="lg" className="w-full" disabled={!ready || send.isPending}>
            {send.isPending ? "Enviando…" : "Enviar a firma"}
          </Button>
          {!ready ? (
            <p role="status" className="text-center text-sm text-muted-foreground">
              {missing.length > 0
                ? `Falta: ${missing.map((m) => m.label || m.key).join(", ")}.`
                : pendingSpecs.length > 0
                  ? `Faltan anexos: ${pendingSpecs.map((x) => x.label).join(", ")}.`
                  : att.uploading
                    ? "Espera a que terminen de subirse los archivos."
                    : "Elige a quién se envía en los pasos de arriba."}
            </p>
          ) : null}
        </div>
      </form>

      <div ref={ref} className="min-w-0">
        <p className="mb-2 text-sm font-medium">Así quedará el documento</p>
        <PdfSurface file={formatPdfUrl(format.id)} page={1} width={width}>
          {format.fields
            .filter((f) => f.page === 1 && values[f.key])
            .map((f) => (
              <span
                key={f.key}
                className="pointer-events-none absolute flex items-center overflow-hidden whitespace-nowrap leading-none text-black"
                style={{
                  left: `${f.x * 100}%`,
                  top: `${f.y * 100}%`,
                  width: `${f.w * 100}%`,
                  height: `${f.h * 100}%`,
                  fontSize: `${(f.fontSize ?? 11) * fontScale}px`,
                  justifyContent: f.align === "center" ? "center" : "flex-start",
                  fontFamily: "Helvetica, Arial, sans-serif",
                }}
              >
                {shown(f.type, values[f.key] ?? "")}
              </span>
            ))}
        </PdfSurface>
        {format.pageCount > 1 ? <p className="mt-2 text-xs text-muted-foreground">Se muestra la primera página; el documento final lleva las {format.pageCount}.</p> : null}
      </div>
    </div>
  );
}

/** Con más opciones que esto, la lista se vuelve buscable en vez de un select enorme. */
const SEARCHABLE_FROM = 12;

/** Lista buscable: se escribe para filtrar (datalist nativo, accesible por teclado) y solo vale una opción exacta. */
function SearchableList({ id, value, options, onChange }: { id: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const hint = `${id}-hint`;
  const match = (t: string) => options.find((o) => o.toLowerCase() === t.trim().toLowerCase());
  const invalid = text.trim() !== "" && !match(text);
  return (
    <>
      <Input
        id={id}
        list={`${id}-options`}
        autoComplete="off"
        placeholder="Escribe para buscar…"
        value={text}
        aria-describedby={hint}
        aria-invalid={invalid}
        onChange={(e) => {
          setText(e.target.value);
          onChange(match(e.target.value) ?? "");
        }}
        onBlur={() => {
          const m = match(text);
          if (m) setText(m);
        }}
      />
      <datalist id={`${id}-options`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <p id={hint} className={cn("text-xs", invalid ? "text-[#8c2018]" : "text-muted-foreground")}>
        {invalid ? "Elige una opción de la lista." : `${options.length} opciones; escribe para filtrar.`}
      </p>
    </>
  );
}

function Field({ variable: v, value, onChange }: { variable: FlowVariable; value: string; onChange: (v: string) => void }) {
  const id = `f-${v.key}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {v.label || v.key}
        {v.required ? null : <span className="font-normal text-muted-foreground"> (opcional)</span>}
      </label>
      {v.type === "select" && (v.options?.length ?? 0) > SEARCHABLE_FROM ? (
        <SearchableList id={id} value={value} options={v.options ?? []} onChange={onChange} />
      ) : v.type === "select" ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <option value="">Elige…</option>
          {(v.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <Input id={id} type={v.type === "number" ? "number" : v.type === "date" ? "date" : "text"} value={value} maxLength={500} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
