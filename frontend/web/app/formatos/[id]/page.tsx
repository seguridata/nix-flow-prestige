"use client";

import { use, useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Pencil } from "lucide-react";
import { toast } from "sonner";

import { AttachmentsBlock, useAttachments } from "@/components/formats/attachments-block";
import { type Person } from "@/components/formats/person-picker";
import { SendToSteps } from "@/components/formats/send-to-steps";
import { PdfSurface, useContainerWidth } from "@/components/formats/pdf-surface";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { attachmentErrorsFrom, attachmentStatus, unmetSpecs } from "@/libs/attachments";
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

  const canEdit = roles.includes("admin") && !!format.data;

  return (
    <AppShell title="Formatos">
      <PageHeader
        back={{ href: "/formatos", label: "Todos los formatos" }}
        title={format.data?.name ?? (format.isError ? "Formato no disponible" : "Formato")}
        description={format.data ? (format.data.description ?? "Llena los datos y envía. El documento se completa solo y la ruta de firmas ya viene definida.") : undefined}
        meta={format.data?.category ?? undefined}
        actions={
          canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/formatos/${id}/editar` as never}>
                <Pencil /> Editar formato
              </Link>
            </Button>
          ) : undefined
        }
      />
      {format.isLoading ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-96 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
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
  const [showPreview, setShowPreview] = useState(false);

  // Qué falta, dicho tal cual: «Falta: 3 cotizaciones del proveedor, monto y elegir a 1 persona».
  const blockers = [
    ...pendingSpecs.map((x) => `${attachmentStatus(x, att.counts[x.key] ?? 0).missing} ${x.label.trim().toLowerCase() || "archivos"}`),
    ...missing.map((m) => (m.label || m.key).toLowerCase()),
    ...(missingPeople.length > 0 ? [missingPeople.length === 1 ? "elegir a 1 persona" : `elegir a ${missingPeople.length} personas`] : []),
  ];
  const blockedText = att.uploading
    ? "Espera a que terminen de subirse los archivos."
    : blockers.length > 0
      ? `Falta: ${blockers.length > 1 ? `${blockers.slice(0, -1).join(", ")} y ${blockers[blockers.length - 1]}` : blockers[0]}.`
      : "";

  const groups = groupVariables(format.flow.variables);
  const setValue = (key: string, val: string) => setValues((s) => ({ ...s, [key]: val }));

  return (
    <form
      className="grid gap-8 pb-28 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0 xl:gap-12"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !send.isPending) send.mutate();
      }}
    >
      <div className="min-w-0 space-y-10">
        {groups.length === 0 ? <p className="text-sm text-muted-foreground">Este formato no pide datos.</p> : null}
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`sec-${g.id}`} className="space-y-4">
            <h2 id={`sec-${g.id}`} className="border-b border-border pb-2 text-lg font-semibold">
              {groups.length > 1 ? g.title : "Datos del formato"}
            </h2>
            <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
              {g.items.map((v) => (
                <VariableField key={v.key} variable={v} value={values[v.key] ?? ""} onChange={(val) => setValue(v.key, val)} />
              ))}
            </div>
          </section>
        ))}

        <AttachmentsBlock specs={specs} state={att} serverErrors={attachmentErrors} />

        <section aria-labelledby="vista-previa" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <h2 id="vista-previa" className="text-lg font-semibold">
              Vista previa del documento
            </h2>
            <Button type="button" variant="outline" size="sm" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? <EyeOff /> : <Eye />} {showPreview ? "Ocultar vista previa" : "Ver cómo quedará"}
            </Button>
          </div>
          {showPreview ? (
            <div ref={ref} className="min-w-0">
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
          ) : (
            <p className="text-sm text-muted-foreground">Mira cómo se van llenando los datos sobre el documento.</p>
          )}
        </section>
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
        <section aria-label="Se enviará a" aria-busy={preview.isFetching}>
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

        <div className="fixed inset-x-0 bottom-0 z-20 space-y-2 border-t border-border bg-background px-4 py-3 md:left-[248px] lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0">
          {!ready ? (
            <p role="status" className="text-sm text-muted-foreground">
              {blockedText}
            </p>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={!ready || send.isPending}>
            {send.isPending ? "Enviando…" : "Enviar a firma"}
          </Button>
        </div>
      </aside>
    </form>
  );
}

type Group = { id: string; title: string; items: FlowVariable[] };

/** Texto largo por naturaleza: el contrato solo distingue texto, número, fecha y lista, así que se infiere de la etiqueta. */
const LONG_TEXT = /descrip|justific|motivo|observ|comentari|necesidad|detalle|notas?\b|objetivo|alcance|antecedent|razon/;
const isLongText = (v: FlowVariable) => v.type === "text" && LONG_TEXT.test(`${v.label} ${v.key}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());

/** Agrupa los datos en secciones cortas conservando el orden: lo que se solicita y, aparte, importes y fechas. */
function groupVariables(vars: readonly FlowVariable[]): Group[] {
  const what = vars.filter((v) => v.type === "select" || v.type === "text");
  const amounts = vars.filter((v) => v.type === "number" || v.type === "date");
  return [
    { id: "que", title: "Qué se solicita", items: what },
    { id: "importe", title: "Importe y fechas", items: amounts },
  ].filter((g) => g.items.length > 0);
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

function VariableField({ variable: v, value, onChange }: { variable: FlowVariable; value: string; onChange: (v: string) => void }) {
  const id = `f-${v.key}`;
  const label = v.label || v.key;
  const searchable = v.type === "select" && (v.options?.length ?? 0) > SEARCHABLE_FROM;
  const long = isLongText(v);
  return (
    <Field
      label={label}
      htmlFor={id}
      optional={!v.required}
      className={cn((long || searchable) && "sm:col-span-2")}
      hint={long ? <span className="tabular-nums">{value.length}/500 caracteres</span> : undefined}
    >
      {searchable ? (
        <SearchableList id={id} value={value} options={v.options ?? []} onChange={onChange} />
      ) : v.type === "select" ? (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Elige una opción</option>
          {(v.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : long ? (
        <Textarea id={id} value={value} rows={4} maxLength={500} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input
          id={id}
          type={v.type === "number" ? "number" : v.type === "date" ? "date" : "text"}
          inputMode={v.type === "number" ? "decimal" : undefined}
          value={value}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}
