"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Circle, CircleCheck, ClipboardCheck, Crosshair, FilePenLine, FileText, FileUp, Info, Paperclip, Save, Trash2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { FormatAiAssistant } from "@/components/ai/format-ai-assistant";
import { AttachmentSpecsEditor } from "@/components/formats/attachment-specs-editor";
import { FlowEditor } from "@/components/formats/flow-editor";
import { FlowRoutePanel } from "@/components/formats/flow-route-panel";
import { PdfSurface, useContainerWidth } from "@/components/formats/pdf-surface";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WizardSteps, type WizardStep } from "@/components/ui/wizard-steps";
import { effectiveMin, specProblems, type AttachmentSpec } from "@/libs/attachments";
import { ENVELOPE_METHOD_OPTIONS, KYC_OPTIONS } from "@/libs/envelope-template";
import { emptyFlow, flowProblems, type Flow, type Who } from "@/libs/flow";
import { placeField, syncFields, unplacedVariables } from "@/libs/format-draft";
import type { SignatureMethod } from "@/libs/types";
import { cn } from "@/libs/utils";
import {
  createFormat,
  deleteFormat,
  fetchFlowDefinitions,
  fetchSignaturePolicy,
  formatPdfUrl,
  saveFormDocument,
  setFormatPublished,
  updateFormat,
  type FormatDetail,
  type FormatDraft,
  type FormatField,
  type FormatKind,
  type SignatureBox,
} from "@/services/formats-service";
import { fetchLookupTables } from "@/services/lookup-tables-service";

const PREFILLS: { value: NonNullable<FormatField["prefill"]> | ""; label: string }[] = [
  { value: "", label: "Lo escribe quien usa el formato" },
  { value: "user.name", label: "Nombre de quien solicita" },
  { value: "user.email", label: "Correo de quien solicita" },
  { value: "today", label: "Fecha de hoy" },
];

/** Una frase corta por método: lo que hace quien firma. */
const METHOD_HINT: Record<SignatureMethod, string> = {
  DIGITAL: "Certificado PAdES de la CA interna.",
  AUTOGRAFA: "Dibuja su firma sobre el PDF.",
  BIOMETRICA: "Prueba de vida (proveedor pendiente).",
  ACCEPT: "Confirma sobre el hash, sin trazo.",
  PASSKEY: "Identidad con la passkey del dispositivo.",
};

function whoText(who: Who): string {
  switch (who.type) {
    case "initiator":
      return "Quien llena el formato";
    case "fixed":
      return who.name || who.email || "Persona fija";
    case "ask":
      return "Se pregunta al llenar el formato";
    case "lookup":
      return "Según una tabla de consulta";
  }
}

/**
 * Alta y edición de un formato como asistente por pasos: documento (o información), datos y firmantes,
 * ubicación de datos en el PDF, anexos, reglas de firma y revisión. Todo el estado vive aquí: cambiar de paso no pierde nada.
 */
export function FormatEditor({ initial, mode = "PDF", proposal }: { initial?: FormatDetail; mode?: FormatKind; proposal?: { name: string; description: string | null; flow: Flow; flowKey?: string; flowVersion?: number } }) {
  const kind: FormatKind = initial?.kind ?? mode;
  const isForm = kind === "FORM";
  const router = useRouter();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const [saved, setSaved] = useState<FormatDetail | undefined>(initial);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(initial?.name ?? proposal?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? proposal?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [flow, setFlow] = useState<Flow>(initial?.flow ?? proposal?.flow ?? { ...emptyFlow() });
  const [flowRef, setFlowRef] = useState<{ key: string; version: number } | null>(
    initial?.flowKey && initial.flowVersion ? { key: initial.flowKey, version: initial.flowVersion } : proposal?.flowKey && proposal.flowVersion ? { key: proposal.flowKey, version: proposal.flowVersion } : null,
  );
  const [fields, setFields] = useState<FormatField[]>(initial?.fields ?? []);
  const [boxes, setBoxes] = useState<SignatureBox[]>(initial?.signatureBoxes ?? []);
  const [specs, setSpecs] = useState<AttachmentSpec[]>(initial?.attachmentSpecs ?? []);
  const [methods, setMethods] = useState<SignatureMethod[] | null>((initial?.methods as SignatureMethod[] | undefined) ?? null);
  const [kycPolicy, setKycPolicy] = useState<FormatDraft["kycPolicy"]>(initial?.kycPolicy ?? "NONE");
  const [requirePasskey, setRequirePasskey] = useState(initial?.requirePasskey ?? false);
  const [dirty, setDirty] = useState(!initial);
  const [pages, setPages] = useState(initial?.pageCount ?? 1);
  const [page, setPage] = useState(1);
  const [placing, setPlacing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [current, setCurrent] = useState(0);
  const [visited, setVisited] = useState<number[]>([0]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const policy = useQuery({ queryKey: ["signature-policy"], queryFn: fetchSignaturePolicy, staleTime: 5 * 60_000 });
  const allowed = policy.data?.allowedMethods;
  // Sin elección propia se parte de Autógrafa (lo natural en un formato) si la política la permite.
  // Un formato guardado puede traer métodos que la política ya no permite: no se arrastran en silencio.
  const chosenMethods: SignatureMethod[] = (
    methods ?? (allowed ? (allowed.includes("AUTOGRAFA") ? ["AUTOGRAFA"] : allowed.slice(0, 1)) : [])
  ).filter((m) => !allowed || allowed.includes(m));

  const published = useQuery({ queryKey: ["flows", "published"], queryFn: () => fetchFlowDefinitions(true) });
  // Con las tablas se validan las consultas del flujo (existen, están activas, sus columnas existen).
  const lookupTables = useQuery({ queryKey: ["lookup-tables"], queryFn: fetchLookupTables, staleTime: 30_000 });
  // Un formato digital publicado no se edita: se despublica primero (la hoja base se regenera al guardar).
  const locked = isForm && !!saved?.published;
  const baseFlows = (published.data ?? []).filter((d) => d.flow);

  const cleanFields = useMemo(() => syncFields(fields, flow.variables), [fields, flow.variables]);
  const unplaced = unplacedVariables(cleanFields, flow.variables);

  // Los mismos pendientes de siempre, repartidos por el paso donde se resuelven.
  const nameProblems = name.trim().length < 3 ? ["Ponle un nombre al formato (mínimo 3 letras)."] : [];
  const pdfProblems = !isForm && !saved && !file ? ["Sube el PDF base."] : [];
  const flowStepProblems = [...(isForm && flow.variables.length === 0 ? ["Agrega al menos un dato que se pida."] : []), ...flowProblems(flow, lookupTables.data)];
  const attachmentProblems = specProblems(specs);
  const rulesProblems = chosenMethods.length === 0 ? ["Elige al menos un método de firma."] : [];

  const stepDefs: { id: string; label: string; description: string; icon: LucideIcon; problems: string[] }[] = isForm
    ? [
        { id: "info", label: "Información", description: "Nombre, categoría y descripción.", icon: Info, problems: nameProblems },
        { id: "flujo", label: "Firmantes", description: "Qué se pide y quién firma.", icon: FilePenLine, problems: flowStepProblems },
        { id: "anexos", label: "Anexos", description: "Archivos que se deben adjuntar.", icon: Paperclip, problems: attachmentProblems },
        { id: "reglas", label: "Reglas", description: "Métodos y verificación.", icon: ClipboardCheck, problems: rulesProblems },
        { id: "revisar", label: "Revisar y guardar", description: "Resumen antes de guardar.", icon: Save, problems: [] },
      ]
    : [
        { id: "doc", label: "Documento", description: "PDF, nombre y descripción.", icon: FileText, problems: [...pdfProblems, ...nameProblems] },
        { id: "flujo", label: "Firmantes", description: "Qué se pide y quién firma.", icon: FilePenLine, problems: flowStepProblems },
        { id: "ubicar", label: "Ubicar datos", description: "Dónde va cada dato en el PDF.", icon: Crosshair, problems: [] },
        { id: "anexos", label: "Anexos", description: "Archivos que se deben adjuntar.", icon: Paperclip, problems: attachmentProblems },
        { id: "reglas", label: "Reglas", description: "Métodos y verificación.", icon: ClipboardCheck, problems: rulesProblems },
        { id: "revisar", label: "Revisar y guardar", description: "Resumen antes de guardar.", icon: Save, problems: [] },
      ];
  const problems = stepDefs.flatMap((s) => s.problems);
  const last = stepDefs.length - 1;
  const stepId = stepDefs[current]?.id;
  const indexOf = (id: string) => stepDefs.findIndex((s) => s.id === id);

  /** Sin guardar se avanza en orden: un paso con pendientes bloquea los siguientes. Ya guardado se navega libre. */
  const blockedReason = (i: number): string | undefined => {
    if (saved) return undefined;
    for (let j = 0; j < i; j++) {
      const sd = stepDefs[j];
      const p = sd?.problems ?? [];
      if (p.length > 0) return `Antes completa «${sd?.label}»: ${p[0]}`;
    }
    return undefined;
  };

  const wizardSteps: WizardStep[] = stepDefs.map((s, i) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    icon: s.icon,
    done: i === last ? !!saved && !dirty && problems.length === 0 : s.problems.length === 0 && (!!saved || visited.includes(i)),
    blocked: blockedReason(i),
  }));

  const go = (i: number) => {
    const n = Math.max(0, Math.min(last, i));
    if (n > current && blockedReason(n)) return;
    moved.current = true;
    setCurrent(n);
    setVisited((v) => (v.includes(n) ? v : [...v, n]));
  };

  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [current]);

  const draft = (): FormatDraft => ({
    name: name.trim(),
    description: description.trim() || undefined,
    category: category.trim() || undefined,
    fields: cleanFields,
    signatureBoxes: boxes,
    attachmentSpecs: specs,
    flow,
    flowKey: flowRef?.key,
    flowVersion: flowRef?.version,
    methods: chosenMethods,
    kycPolicy,
    requirePasskey,
  });

  const save = useMutation({
    mutationFn: () =>
      isForm ? saveFormDocument(draft(), saved?.id) : saved ? updateFormat(saved.id, draft()) : createFormat(file!, draft()),
    onSuccess: async (f) => {
      const wasNew = !saved;
      setSaved(f);
      setFields(f.fields);
      setBoxes(f.signatureBoxes);
      setSpecs(f.attachmentSpecs ?? specs);
      setPages(f.pageCount || 1);
      setDirty(false);
      setFile(null);
      toast.success(wasNew ? (isForm ? "Formato digital creado como borrador." : "Formato creado como borrador.") : "Cambios guardados.");
      await queryClient.invalidateQueries({ queryKey: ["formats"] });
      await queryClient.invalidateQueries({ queryKey: ["format", f.id] });
      if (wasNew) router.replace(`/formatos/${f.id}/editar` as never);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: (next: boolean) => setFormatPublished(saved!.id, next),
    onSuccess: async (f) => {
      setSaved(f);
      toast.success(f.published ? "Formato publicado: ya lo ve todo el mundo." : "Formato despublicado.");
      await queryClient.invalidateQueries({ queryKey: ["formats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteFormat(saved!.id),
    onSuccess: async () => {
      toast.success("Formato eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["formats"] });
      router.push("/formatos" as never);
    },
    onError: (e: Error) => {
      setConfirmDelete(false);
      toast.error(e.message);
    },
  });

  const pdfSource: string | File | null = file ?? (saved ? formatPdfUrl(saved.id) : null);
  const canSave = !locked && problems.length === 0 && dirty && !save.isPending;
  const stepBlock = current < last ? blockedReason(current + 1) : undefined;
  const saveLabel = save.isPending ? "Guardando…" : saved ? "Guardar cambios" : isForm ? "Crear formato digital" : "Crear formato";

  /* ───────── Pasos ───────── */

  const nameField = (
    <Field label="Nombre del formato" htmlFor="ed-name" error={dirty && nameProblems.length > 0 && name.length > 0 ? nameProblems[0] : undefined}>
      <Input id="ed-name" value={name} maxLength={120} placeholder="Ej. Solicitud de vacaciones" onChange={(e) => touch(setName)(e.target.value)} />
    </Field>
  );
  const metaFields = (
    <>
      <Field label="Categoría" htmlFor="ed-category" optional>
        <Input id="ed-category" value={category} maxLength={60} placeholder="Ej. Recursos Humanos" onChange={(e) => touch(setCategory)(e.target.value)} />
      </Field>
      <Field label="Descripción" htmlFor="ed-description" optional hint="Se muestra a quien elige el formato en la biblioteca.">
        <Textarea id="ed-description" value={description} maxLength={300} rows={3} onChange={(e) => touch(setDescription)(e.target.value)} />
      </Field>
    </>
  );

  const documentStep = (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-lg border border-border p-3">
        <FileUp className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm">{file ? file.name : saved ? "PDF guardado" : "Aún no hay PDF"}</span>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (saved) {
              toast.error("Para cambiar el PDF, crea un formato nuevo: así los envíos ya hechos conservan su documento.");
              return;
            }
            setFile(f);
            setDirty(true);
            if (!name.trim()) setName(f.name.replace(/\.pdf$/i, "").replace(/[_]+/g, " "));
          }}
        />
        {!saved ? (
          <Button type="button" variant="outline" onClick={() => input.current?.click()}>
            {file ? "Cambiar" : "Elegir PDF"}
          </Button>
        ) : null}
      </div>
      {!saved && file ? (
        <FormatAiAssistant
          file={file}
          onApply={(meta) => {
            setName(meta.name);
            setDescription(meta.description ?? "");
            setFlow(meta.flow);
            setFlowRef(null);
            setFields(meta.fields);
            setBoxes(meta.signatureBoxes);
            setDirty(true);
          }}
        />
      ) : null}
      {nameField}
      {metaFields}
    </div>
  );

  const infoStep = (
    <div className="space-y-5">
      <p className="rounded-lg bg-muted p-3 text-sm text-foreground/80">
        No subes un PDF: el sistema genera la hoja base con el título, una caja por cada dato, la lista de anexos y una caja de firma por paso. Después se
        comporta como cualquier formato: se rellena, sigue el flujo y se firma.
      </p>
      {nameField}
      {metaFields}
    </div>
  );

  const flowStep = (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
    <div className="min-w-0 max-w-3xl space-y-5">
      {baseFlows.length > 0 ? (
        <Field
          label="Partir de un flujo publicado"
          htmlFor="ed-base-flow"
          optional
          hint={flowRef ? `Basado en «${flowRef.key}» v${flowRef.version}. Si cambias algo, deja de estar ligado a él.` : "Copia sus datos y pasos para que los ajustes."}
        >
          <Select
            id="ed-base-flow"
            value=""
            onChange={(e) => {
              const def = baseFlows.find((d) => d.id === e.target.value);
              if (!def?.flow) return;
              setFlow(def.flow);
              setFlowRef({ key: def.key, version: def.version });
              setDirty(true);
            }}
          >
            <option value="">{flowRef ? `Basado en «${flowRef.key}» v${flowRef.version}` : "Elige uno…"}</option>
            {baseFlows.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · v{d.version}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <FlowEditor
        value={flow}
        onChange={(f) => {
          setFlow(f);
          setFlowRef(null);
          setDirty(true);
        }}
      />
    </div>
    <FlowRoutePanel flow={flow} problems={flowStepProblems} className="lg:sticky lg:top-20" />
    </div>
  );

  const attachmentsStep = (
    <div className="space-y-4">
      {specs.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Este formato no pide anexos. Agrégalos solo si hace falta.</p> : null}
      <AttachmentSpecsEditor
        value={specs}
        onChange={(v) => {
          setSpecs(v);
          setDirty(true);
        }}
      />
    </div>
  );

  const rulesStep = (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-sm font-medium">Métodos permitidos</legend>
        <p className="mb-3 mt-0.5 text-sm text-muted-foreground">Quien firma elige uno.</p>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {ENVELOPE_METHOD_OPTIONS.filter((m) => !allowed || allowed.includes(m.value)).map((m) => {
            const on = chosenMethods.includes(m.value);
            return (
              <li key={m.value}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => touch(setMethods)(on ? chosenMethods.filter((x) => x !== m.value) : [...chosenMethods, m.value])}
                  className={cn(
                    "flex min-h-16 w-full items-center gap-3 rounded-lg border-2 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    on ? "border-foreground bg-accent" : "border-border hover:border-foreground/50",
                  )}
                >
                  {on ? (
                    <CircleCheck aria-hidden className="size-6 shrink-0 text-[var(--brand-green-deep)]" strokeWidth={2.25} />
                  ) : (
                    <Circle aria-hidden className="size-6 shrink-0 text-foreground/40" strokeWidth={1.75} />
                  )}
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">{m.label}</span>
                    <span className="block text-sm text-foreground/75">{METHOD_HINT[m.value]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <Field label="Verificación de identidad" htmlFor="ed-kyc">
        <Select id="ed-kyc" value={kycPolicy} onChange={(e) => touch(setKycPolicy)(e.target.value as FormatDraft["kycPolicy"])}>
          {KYC_OPTIONS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Exigir passkey" htmlFor="ed-passkey" hint="Se pide la passkey para firmar con cualquier método.">
        <Switch id="ed-passkey" checked={requirePasskey} onCheckedChange={touch(setRequirePasskey)} />
      </Field>
    </div>
  );

  const summary: { id: string; label: string; value: React.ReactNode }[] = [
    { id: isForm ? "info" : "doc", label: "Nombre", value: <>{name.trim() || "Sin nombre"}{category.trim() ? <span className="text-muted-foreground"> · {category.trim()}</span> : null}</> },
    ...(!isForm ? [{ id: "doc", label: "Documento", value: file ? file.name : saved ? "PDF guardado" : "Sin PDF" }] : []),
    {
      id: "flujo",
      label: "Datos que se piden",
      value: flow.variables.length === 0 ? "Ninguno" : <>{flow.variables.length}: <span className="text-muted-foreground">{flow.variables.map((v) => v.label || v.key).join(", ")}</span></>,
    },
    {
      id: "flujo",
      label: "Pasos de firma",
      value:
        flow.steps.length === 0 ? (
          "Ninguno"
        ) : (
          <ol className="space-y-0.5">
            {flow.steps.map((s, i) => (
              <li key={s.id}>
                {i + 1}. {s.label || "Paso"} <span className="text-muted-foreground">· {whoText(s.who)}</span>
              </li>
            ))}
          </ol>
        ),
    },
    ...(!isForm
      ? [{ id: "ubicar", label: "Datos ubicados en el PDF", value: flow.variables.length === 0 ? "Ninguno" : `${flow.variables.length - unplaced.length} de ${flow.variables.length}` }]
      : []),
    {
      id: "anexos",
      label: "Anexos",
      value:
        specs.length === 0 ? (
          "Ninguno"
        ) : (
          <ul className="space-y-0.5">
            {specs.map((s) => (
              <li key={s.key}>
                {s.label || "Sin nombre"} <span className="text-muted-foreground">· mínimo {effectiveMin(s)}, máximo {s.max}</span>
              </li>
            ))}
          </ul>
        ),
    },
    { id: "reglas", label: "Métodos permitidos", value: chosenMethods.map((m) => ENVELOPE_METHOD_OPTIONS.find((o) => o.value === m)?.label ?? m).join(", ") || "Ninguno" },
    {
      id: "reglas",
      label: "Verificación",
      value: `${KYC_OPTIONS.find((k) => k.value === kycPolicy)?.label ?? kycPolicy}${requirePasskey ? " · Exige passkey" : ""}`,
    },
  ];

  const problemGroups = stepDefs.filter((s) => s.problems.length > 0);

  const reviewStep = (
    <div className="space-y-6">
      {problemGroups.length > 0 ? (
        <div role="status" className="space-y-3 rounded-lg border border-border bg-muted/50 p-4">
          <p className="text-sm font-medium">Falta esto para poder guardar:</p>
          {problemGroups.map((g) => (
            <div key={g.id} className="space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {g.label}
                <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={() => go(indexOf(g.id))}>
                  Ir al paso
                </Button>
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {g.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      <dl className="divide-y divide-border rounded-lg border border-border">
        {summary.map((row, i) => (
          <div key={i} className="flex flex-wrap items-start gap-x-4 gap-y-1 p-3.5">
            <dt className="w-44 shrink-0 text-sm text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 flex-1 text-sm">{row.value}</dd>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-9" aria-label={`Cambiar: ${row.label}`} onClick={() => go(indexOf(row.id))}>
              Cambiar
            </Button>
          </div>
        ))}
      </dl>

      {!isForm && unplaced.length > 0 && saved ? (
        <p className="text-sm text-muted-foreground">
          Sin colocar en el documento: {unplaced.map((v) => v.label || v.key).join(", ")}. Se piden, pero no aparecen impresos.
        </p>
      ) : null}

      {saved ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={dirty || publish.isPending} onClick={() => publish.mutate(!saved.published)}>
            {saved.published ? "Despublicar" : "Publicar para todos"}
          </Button>
          <Button variant="ghost" className="ml-auto text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Eliminar
          </Button>
          {dirty ? <span className="w-full text-sm text-muted-foreground">Guarda los cambios para poder publicar.</span> : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Se guarda como borrador. Podrás publicarlo después de crearlo.</p>
      )}
    </div>
  );

  const content: Record<string, { title: string; text: string; body: React.ReactNode }> = {
    info: { title: "Información del formato", text: "Cómo se llama y para qué sirve.", body: infoStep },
    doc: { title: "Documento base", text: "Sube el PDF y dale nombre.", body: documentStep },
    flujo: { title: "Datos y firmantes", text: "Define qué datos se piden y quién firma, en qué orden.", body: flowStep },
    ubicar: {
      title: "Ubicar datos en el PDF",
      text: "Elige un dato y dibuja un rectángulo sobre el documento.",
      body: (
        <LocateStep
          flow={flow}
          cleanFields={cleanFields}
          fields={fields}
          setFields={touch(setFields)}
          placing={placing}
          setPlacing={setPlacing}
          page={page}
          setPage={setPage}
          pages={pages}
          setPages={setPages}
          pdfSource={pdfSource}
          onGoToFlow={() => go(indexOf("flujo"))}
        />
      ),
    },
    anexos: {
      title: "Anexos del formato",
      text: "Archivos que quien llena el formato debe adjuntar, por ejemplo cotizaciones o comprobantes. Cada anexo define su mínimo. Se guardan cifrados en el mismo expediente y quienes reciben la solicitud pueden leerlos.",
      body: attachmentsStep,
    },
    reglas: { title: "Reglas de firma", text: "Con qué métodos se puede firmar y qué identidad se verifica.", body: rulesStep },
    revisar: { title: "Revisar y guardar", text: "Revisa el resumen; con «Cambiar» vuelves al paso que quieras.", body: reviewStep },
  };
  const view = content[stepId ?? "info"] ?? content[stepDefs[0]?.id ?? "info"] ?? content.info!;
  const wide = stepId === "ubicar" || stepId === "flujo";

  return (
    <div className="flex flex-col gap-6">
      <WizardSteps steps={wizardSteps} current={current} onSelect={go} ariaLabel="Pasos del formato" className="py-1" />

      {locked ? (
        <p role="status" className="rounded-md border border-border bg-muted/50 p-3 text-sm">
          Este formato digital está publicado y no se edita. Despublícalo para cambiarlo; la hoja base se vuelve a generar al guardar.
        </p>
      ) : null}

      <section
        aria-labelledby="ed-step-title"
        className={cn("min-w-0 space-y-6 rounded-2xl border border-border bg-background p-5 shadow-subtle sm:p-8", wide ? "" : "max-w-3xl")}
      >
        <div className="flex items-start gap-4 border-b border-border pb-5">
          {(() => {
            const StepIcon = stepDefs[current]?.icon;
            return StepIcon ? (
              <span aria-hidden className="flex shrink-0 items-center justify-center text-primary">
                <StepIcon className="size-10" strokeWidth={1.5} />
              </span>
            ) : null;
          })()}
          <div className="min-w-0">
            <h2 id="ed-step-title" ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">
              {view.title}
            </h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{view.text}</p>
          </div>
        </div>
        {stepId === "revisar" ? (
          // La revisión nunca se bloquea: ahí están Publicar y Eliminar de un formato ya publicado.
          view.body
        ) : (
          <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
            {view.body}
          </fieldset>
        )}
      </section>

      <div className="sticky bottom-0 z-10 -mx-1 border-t border-border bg-muted px-3 pb-16 pt-3 md:pb-3 md:pr-36">
        {stepBlock ? (
          <p role="status" className="mb-2 text-sm text-muted-foreground">
            {stepBlock.replace(/^Antes completa «[^»]+»: /, "Para seguir: ")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="button" variant="outline" disabled={current === 0} onClick={() => go(current - 1)}>
            <ArrowLeft /> Atrás
          </Button>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5">
            {current < last ? (
              <>
                <Button type="button" variant="outline" disabled={!canSave} onClick={() => save.mutate()}>
                  {save.isPending ? "Guardando…" : "Guardar"}
                </Button>
                <Button type="button" disabled={!!stepBlock} onClick={() => go(current + 1)}>
                  Siguiente <ArrowRight />
                </Button>
              </>
            ) : (
              <Button type="button" disabled={!canSave} onClick={() => save.mutate()}>
                {saveLabel}
              </Button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`¿Eliminar «${saved?.name ?? ""}»?`}
        description="Deja de aparecer en la biblioteca. Los documentos que ya se enviaron con este formato no se tocan."
        confirmLabel="Eliminar formato"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

/** «Ubicar datos en el PDF»: lista de datos a la izquierda y vista del documento a la derecha, a ancho completo. */
function LocateStep({
  flow,
  cleanFields,
  fields,
  setFields,
  placing,
  setPlacing,
  page,
  setPage,
  pages,
  setPages,
  pdfSource,
  onGoToFlow,
}: {
  flow: Flow;
  cleanFields: FormatField[];
  fields: FormatField[];
  setFields: (v: FormatField[]) => void;
  placing: string | null;
  setPlacing: (v: string | null) => void;
  page: number;
  setPage: (v: number) => void;
  pages: number;
  setPages: (v: number) => void;
  pdfSource: string | File | null;
  onGoToFlow: () => void;
}) {
  const { ref, width } = useContainerWidth(560);
  const placingVar = flow.variables.find((v) => v.key === placing) ?? null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div>
        {flow.variables.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            <p>Primero agrega los datos que se piden.</p>
            <Button type="button" variant="outline" onClick={onGoToFlow}>
              Ir a «Datos y firmantes»
            </Button>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {flow.variables.map((v) => {
              const f = cleanFields.find((x) => x.key === v.key);
              const adjustable = f && (v.type === "text" || v.type === "date");
              return (
                <li key={v.key} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{v.label || v.key}</span>
                      <span className="block text-xs text-muted-foreground">{f ? `Colocado en la página ${f.page}` : "Sin colocar: no aparecerá en el documento"}</span>
                    </span>
                    <Button
                      type="button"
                      variant={placing === v.key ? "default" : "outline"}
                      aria-pressed={placing === v.key}
                      onClick={() => {
                        setPlacing(placing === v.key ? null : v.key);
                        if (f) setPage(f.page);
                      }}
                    >
                      <Crosshair /> {placing === v.key ? "Dibuja sobre el PDF" : f ? "Recolocar" : "Colocar"}
                    </Button>
                    {f ? (
                      <Button type="button" size="icon" variant="ghost" className="size-11" aria-label={`Quitar «${v.label || v.key}» del documento`} onClick={() => setFields(fields.filter((x) => x.key !== v.key))}>
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                  {f ? (
                    <details className="group mt-2">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                        Ajustes del campo (valor inicial, tamaño, alineación)
                      </summary>
                      <div className="mt-2 grid gap-3 pb-1 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                        {adjustable ? (
                          <Field label="Valor inicial" htmlFor={`pf-${v.key}`} className="sm:col-span-2 lg:col-span-1 2xl:col-span-2">
                            <Select
                              id={`pf-${v.key}`}
                              value={f.prefill ?? ""}
                              onChange={(e) => setFields(fields.map((x) => (x.key === v.key ? { ...x, prefill: (e.target.value || undefined) as FormatField["prefill"] } : x)))}
                            >
                              {PREFILLS.filter((p) => v.type === "text" || p.value === "" || p.value === "today").map((p) => (
                                <option key={p.value} value={p.value}>
                                  {p.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        ) : null}
                        <Field label="Tamaño de letra" htmlFor={`ps-${v.key}`}>
                          <Input
                            id={`ps-${v.key}`}
                            type="number"
                            min={6}
                            max={32}
                            value={f.fontSize ?? 11}
                            onChange={(e) => setFields(fields.map((x) => (x.key === v.key ? { ...x, fontSize: Math.max(6, Math.min(32, Number(e.target.value) || 11)) } : x)))}
                          />
                        </Field>
                        <Field label="Alineación" htmlFor={`pa-${v.key}`}>
                          <Select
                            id={`pa-${v.key}`}
                            value={f.align ?? "left"}
                            onChange={(e) => setFields(fields.map((x) => (x.key === v.key ? { ...x, align: e.target.value as "left" | "center" } : x)))}
                          >
                            <option value="left">A la izquierda</option>
                            <option value="center">Centrado</option>
                          </Select>
                        </Field>
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div ref={ref} className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        {pdfSource ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{placingVar ? `Dibuja dónde va «${placingVar.label || placingVar.key}»` : "Vista del documento"}</p>
              {pages > 1 ? (
                <div className="flex items-center gap-1 text-sm">
                  <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Anterior
                  </Button>
                  <span className="px-2 tabular-nums">
                    {page} de {pages}
                  </span>
                  <Button type="button" size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    Siguiente
                  </Button>
                </div>
              ) : null}
            </div>
            <PdfSurface
              file={pdfSource}
              page={page}
              width={width}
              onPages={setPages}
              onDraw={
                placingVar
                  ? (r) => {
                      setFields(placeField(fields, placingVar, { page, ...r }));
                      setPlacing(null);
                    }
                  : undefined
              }
            >
              {cleanFields
                .filter((f) => f.page === page)
                .map((f) => (
                  <span
                    key={f.key}
                    className="pointer-events-none absolute flex items-center overflow-hidden border border-dashed border-foreground bg-primary/20 px-1 text-[11px] font-medium leading-none"
                    style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
                  >
                    {f.label || f.key}
                  </span>
                ))}
            </PdfSurface>
          </>
        ) : (
          <div className="grid h-80 place-items-center rounded-lg border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
            Elige un PDF en el primer paso para ver el documento aquí.
          </div>
        )}
      </div>
    </div>
  );
}
