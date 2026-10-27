"use client";

import { use, useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { AttachmentsBlock, useAttachments } from "@/components/formats/attachments-block";
import { type Person } from "@/components/formats/person-picker";
import { SendToSteps } from "@/components/formats/send-to-steps";
import { LivePreview } from "@/components/formats/live-preview";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { attachmentErrorsFrom, attachmentStatus, unmetSpecs } from "@/libs/attachments";
import { optionsFor, type FlowVariable } from "@/libs/flow";
import { needsPerson } from "@/libs/format-steps";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";
import { ApiError } from "@/services/api-client";
import {
  fetchFormat,
  instantiateFormat,
  previewFormatFlow,
  type AskedSigner,
  type FormatDetail,
  type ResolvedStep,
} from "@/services/formats-service";

const today = () => new Date().toISOString().slice(0, 10);

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

  // Dato con el foco (resalta su lugar en el documento) y pestaña de la columna lateral.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [side, setSide] = useState<"doc" | "route">("doc");

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
  const setValue = (key: string, val: string) =>
    setValues((s) => {
      const next = { ...s, [key]: val };
      // Una lista dependiente solo conserva su valor si sigue siendo una opción del nuevo valor de la que depende.
      for (const v of format.flow.variables) {
        if (v.dependsOn?.variable === key && next[v.key] && !optionsFor(v, next).includes(next[v.key]!)) next[v.key] = "";
      }
      return next;
    });

  return (
    <form
      className="grid gap-8 pb-28 lg:grid-cols-[minmax(0,1fr)_24rem] lg:pb-0 xl:grid-cols-[minmax(0,1fr)_28rem] xl:gap-12"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !send.isPending) send.mutate();
      }}
    >
      <div
        className="min-w-0 space-y-10"
        onFocusCapture={(e) => {
          const id = (e.target as HTMLElement).id;
          setActiveKey(id.startsWith("f-") ? id.slice(2) : null);
        }}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActiveKey(null);
        }}
      >
        {groups.length === 0 ? <p className="text-sm text-muted-foreground">Este formato no pide datos.</p> : null}
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`sec-${g.id}`} className="space-y-4">
            <h2 id={`sec-${g.id}`} className="border-b border-border pb-2 text-lg font-semibold">
              {groups.length > 1 ? g.title : "Datos del formato"}
            </h2>
            <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
              {g.items.map((v) => (
                <VariableField
                  key={v.key}
                  variable={v}
                  options={optionsFor(v, values)}
                  parentLabel={v.dependsOn ? (format.flow.variables.find((x) => x.key === v.dependsOn!.variable)?.label ?? v.dependsOn.variable) : undefined}
                  value={values[v.key] ?? ""}
                  onChange={(val) => setValue(v.key, val)}
                />
              ))}
            </div>
          </section>
        ))}

        <AttachmentsBlock specs={specs} state={att} serverErrors={attachmentErrors} />
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <SideTabs
          value={side}
          onChange={setSide}
          tabs={[
            { id: "doc", label: "Documento" },
            { id: "route", label: "Ruta de envío", note: missingPeople.length > 0 ? `${missingPeople.length} por elegir` : undefined },
          ]}
        />

        <section id="side-panel-doc" role="tabpanel" aria-labelledby="side-tab-doc" hidden={side !== "doc"}>
          <LivePreview format={format} values={values} activeKey={activeKey} />
        </section>

        <section
          id="side-panel-route"
          role="tabpanel"
          aria-labelledby="side-tab-route"
          hidden={side !== "route"}
          aria-label="Se enviará a"
          aria-busy={preview.isFetching}
        >
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

/** Pestañas de la columna lateral (documento en vivo / ruta de envío); con un aviso cuando falta algo en la otra. */
function SideTabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { id: T; label: string; note?: string }[];
}) {
  return (
    <div role="tablist" aria-label="Vista lateral" className="flex gap-1 rounded-lg bg-muted p-1">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          id={`side-tab-${t.id}`}
          role="tab"
          aria-selected={value === t.id}
          aria-controls={`side-panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]!;
            onChange(next.id);
            document.getElementById(`side-tab-${next.id}`)?.focus();
          }}
          className={cn(
            "flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            value === t.id ? "bg-background font-semibold text-foreground shadow-subtle" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
          )}
        >
          {t.label}
          {t.note ? <span className="text-xs font-medium text-[#8c2018]">· {t.note}</span> : null}
        </button>
      ))}
    </div>
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

function VariableField({
  variable: v,
  options,
  parentLabel,
  value,
  onChange,
}: {
  variable: FlowVariable;
  /** Opciones vigentes: todas, o solo las del valor elegido en la lista de la que depende. */
  options: string[];
  parentLabel?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `f-${v.key}`;
  const label = v.label || v.key;
  const waiting = v.type === "select" && !!parentLabel && options.length === 0;
  const searchable = v.type === "select" && options.length > SEARCHABLE_FROM;
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
        <SearchableList key={options.join("|")} id={id} value={value} options={options} onChange={onChange} />
      ) : v.type === "select" ? (
        <Select id={id} value={value} disabled={waiting} onChange={(e) => onChange(e.target.value)}>
          <option value="">{waiting ? `Primero elige «${parentLabel}»` : "Elige una opción"}</option>
          {options.map((o) => (
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
