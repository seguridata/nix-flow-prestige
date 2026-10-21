"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Check, CheckCircle2, CircleDashed, FileText, Fingerprint, KeyRound, PenTool, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SignerAutocomplete } from "@/components/new/signer-autocomplete";
import { cn } from "@/libs/utils";
import { createCase } from "@/services/cases-service";
import { createDocument } from "@/services/documents-service";
import { createEnvelopeTemplate, createSignatureRequest, fetchEnvelopeTemplates } from "@/services/signature-requests-service";
import { fetchColleagues } from "@/services/directory-service";
import {
  applyEnvelopeTemplate,
  draftToTemplateBody,
  ENVELOPE_METHOD_OPTIONS,
  KYC_OPTIONS,
  type KycPolicy,
} from "@/libs/envelope-template";
import type { Colleague, SignatureMethod } from "@/libs/types";

const signerSchema = z.object({
  name: z.string().min(2, "Nombre requerido"),
  email: z.string().email("Email inválido"),
  role: z.enum(["FIRMANTE", "REVISOR"]),
});

const formSchema = z.object({
  title: z.string().min(3, "Dale un título al documento"),
  sequential: z.boolean(),
  signers: z.array(signerSchema).min(1, "Agrega al menos un firmante"),
});

type FormValues = z.infer<typeof formSchema>;

const METHOD_ICONS = {
  DIGITAL: ShieldCheck,
  AUTOGRAFA: PenTool,
  BIOMETRICA: Fingerprint,
  ACCEPT: CheckCircle2,
  PASSKEY: KeyRound,
} as const;

const STEPS = ["Documento", "Firmantes", "Opciones", "Revisar"] as const;

export default function NewSignatureRequestPage() {
  return (
    <Suspense fallback={<div className="p-8">Preparando el envío…</div>}>
      <NewSignatureRequest />
    </Suspense>
  );
}

function NewSignatureRequest() {
  const router = useRouter();
  const presetTemplate = useSearchParams().get("plantilla");
  const presetApplied = useRef(false);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [methods, setMethods] = useState<SignatureMethod[]>(["DIGITAL"]);
  const [requirePasskey, setRequirePasskey] = useState(false);
  const [kycPolicy, setKycPolicy] = useState<KycPolicy>("NONE");
  const [slaHours, setSlaHours] = useState(72);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const templatesQuery = useQuery({ queryKey: ["envelope-templates"], queryFn: fetchEnvelopeTemplates });
  const templates = templatesQuery.data ?? [];

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      sequential: true,
      signers: [{ name: "", email: "", role: "FIRMANTE" }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "signers" });

  // Directorio del tenant para autocompletar firmantes. Degrada en silencio:
  // si falla, los inputs siguen siendo texto libre.
  const colleaguesQuery = useQuery({ queryKey: ["colleagues"], queryFn: fetchColleagues });
  const colleagues: Colleague[] = colleaguesQuery.data ?? [];

  const pickInto = (index: number) => (c: Colleague) => {
    form.setValue(`signers.${index}.name`, c.name ?? "", { shouldValidate: true, shouldDirty: true });
    form.setValue(`signers.${index}.email`, c.email ?? "", { shouldValidate: true, shouldDirty: true });
  };

  function toggleMethod(method: SignatureMethod) {
    setMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method],
    );
  }

  // Desde Plantillas, «Usar» llega con ?plantilla=<id>: se aplica una sola vez cuando carga la lista.
  useEffect(() => {
    if (!presetTemplate || presetApplied.current || templates.length === 0) return;
    presetApplied.current = true;
    if (templates.some((t) => t.id === presetTemplate)) onPickTemplate(presetTemplate);
  });

  function onPickTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    const draft = applyEnvelopeTemplate(template);
    setMethods(draft.methods);
    setRequirePasskey(draft.requirePasskey);
    setKycPolicy(draft.kycPolicy);
    setSlaHours(draft.slaHours);
    form.setValue("sequential", draft.sequential);
  }

  async function saveTemplate() {
    const name = templateName.trim();
    if (name.length < 1) {
      toast.error("Ponle un nombre a la plantilla.");
      return;
    }
    if (methods.length === 0) {
      toast.error("Autoriza al menos un método antes de guardar la plantilla.");
      return;
    }
    setSavingTemplate(true);
    try {
      const created = await createEnvelopeTemplate(
        draftToTemplateBody(name, {
          methods,
          sequential: form.getValues("sequential"),
          kycPolicy,
          requirePasskey,
          slaHours,
        }),
      );
      setTemplateId(created.id);
      setTemplateName("");
      await templatesQuery.refetch();
      toast.success("Plantilla guardada. El próximo envío puede partir de ella.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la plantilla.");
    } finally {
      setSavingTemplate(false);
    }
  }

  async function goNext() {
    if (step === 0) {
      const valid = await form.trigger("title");
      if (!valid) return;
      if (!file) {
        toast.error("Adjunta el PDF que se va a firmar.");
        return;
      }
    }
    if (step === 1) {
      const valid = await form.trigger("signers");
      if (!valid) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function onSubmit(values: FormValues) {
    if (!file) {
      toast.error("Adjunta el PDF que se va a firmar.");
      return;
    }
    if (methods.length === 0) {
      toast.error("Autoriza al menos un método de firma.");
      return;
    }

    setSubmitting(true);
    try {
      const kase = await createCase({ title: values.title });
      const document = await createDocument({ caseId: kase.id, file });
      await createSignatureRequest({
        documentId: document.id,
        templateId: templateId || undefined,
        methods,
        order: values.sequential ? "SECUENCIAL" : "PARALELO",
        slaHours,
        requirePasskey,
        kycPolicy,
        signers: values.signers.map((s) => ({
          signerId: s.email,
          name: s.name,
          email: s.email,
          role: s.role,
        })),
      });

      toast.success("Solicitud de firma enviada.");
      router.push(`/documents/${document.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar la solicitud.");
    } finally {
      setSubmitting(false);
    }
  }

  const title = form.watch("title");
  const sequential = form.watch("sequential");
  const watchedSigners = form.watch("signers");
  const namedSigners = (watchedSigners ?? []).filter((s) => s?.email?.trim()).length;
  const last = STEPS.length - 1;

  const summary: SummaryItem[] = [
    {
      label: "Documento",
      step: 0,
      done: title.trim().length >= 3 && !!file,
      value: title.trim() ? title.trim() : "Sin título",
      detail: file ? file.name : "Falta adjuntar el PDF",
    },
    {
      label: "Firmantes",
      step: 1,
      done: namedSigners > 0,
      value: `${fields.length} ${fields.length === 1 ? "participante" : "participantes"} · ${sequential ? "uno por uno, en orden" : "todos a la vez"}`,
      detail: namedSigners === 0 ? "Falta el correo del primer firmante" : undefined,
    },
    {
      label: "Métodos de firma",
      step: 2,
      done: methods.length > 0,
      value: methods.length > 0 ? ENVELOPE_METHOD_OPTIONS.filter((o) => methods.includes(o.value)).map((o) => o.label).join(", ") : "Ninguno",
      detail: methods.length === 0 ? "Autoriza al menos uno" : undefined,
    },
    {
      label: "Identidad y plazo",
      step: 2,
      done: true,
      value: `${KYC_OPTIONS.find((o) => o.value === kycPolicy)?.label ?? ""}${requirePasskey ? " · con passkey" : ""} · ${slaHours} h`,
    },
  ];

  return (
    <AppShell title="Enviar documento">
      <PageHeader
        back={{ href: "/sent", label: "Enviados" }}
        title="Enviar documento a firma"
        description="Cuatro pasos: el documento, quién firma, cómo y una última revisión."
      />

      <ol aria-label="Pasos para enviar" className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-2">
        {STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          const content = (
            <>
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  done && "bg-primary text-primary-foreground",
                  current && "bg-secondary text-secondary-foreground",
                  !done && !current && "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : index + 1}
              </span>
              <span className={cn("text-sm", current ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
              {done ? <span className="sr-only"> (completado)</span> : null}
            </>
          );
          return (
            <li key={label} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
              {done ? (
                <button type="button" onClick={() => setStep(index)} className="flex items-center gap-2 rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  {content}
                </button>
              ) : (
                <span className="flex items-center gap-2">{content}</span>
              )}
              {index < STEPS.length - 1 ? <span aria-hidden className="mx-1 hidden h-px w-8 bg-border sm:block" /> : null}
            </li>
          );
        })}
      </ol>

      <div className={cn("grid gap-8", step < last && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
        <form
          className="mx-auto w-full max-w-2xl min-w-0 space-y-8 lg:mx-0"
          onSubmit={(e) => {
            // Enter en un paso intermedio avanza; solo el último paso envía.
            if (step < last) {
              e.preventDefault();
              void goNext();
              return;
            }
            void form.handleSubmit(onSubmit)(e);
          }}
        >
          {step === 0 ? (
            <section aria-labelledby="paso-documento" className="space-y-6">
              <div>
                <h2 id="paso-documento" className="text-xl font-semibold">
                  ¿Qué documento vas a enviar a firmar?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Dale un título claro y adjunta el PDF.</p>
              </div>

              <Field label="Título del documento" htmlFor="title" error={form.formState.errors.title?.message}>
                <Input id="title" placeholder="Contrato de arrendamiento - Sucursal Polanco" aria-invalid={!!form.formState.errors.title} {...form.register("title")} />
              </Field>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Archivo PDF</span>
                <label
                  htmlFor="pdf-upload"
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-ring",
                    file ? "border-foreground/40 bg-background" : "border-border bg-muted/40 hover:bg-muted",
                  )}
                >
                  {file ? <FileText className="size-6" strokeWidth={1.5} aria-hidden /> : <Upload className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden />}
                  <span className="text-sm font-medium break-all">{file ? file.name : "Arrastra el PDF aquí o haz clic para elegirlo"}</span>
                  <span className="text-xs text-muted-foreground">{file ? "Haz clic para cambiarlo" : "Solo archivos .pdf"}</span>
                  <input id="pdf-upload" type="file" accept="application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
            </section>
          ) : null}

          {step === 1 ? (
            <section aria-labelledby="paso-firmantes" className="space-y-6">
              <div>
                <h2 id="paso-firmantes" className="text-xl font-semibold">
                  ¿Quién debe firmar o revisar este documento?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Agrega a los participantes en el orden en que intervienen.</p>
              </div>

              <ul className="flex flex-col gap-3">
                {fields.map((field, index) => (
                  <li key={field.id} className="rounded-lg border border-border bg-background p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">Participante {index + 1}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                        disabled={fields.length === 1}
                        aria-label={`Quitar al participante ${index + 1}`}
                      >
                        <Trash2 /> Quitar
                      </Button>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Nombre" error={form.formState.errors.signers?.[index]?.name?.message}>
                        <SignerAutocomplete
                          register={form.register(`signers.${index}.name`)}
                          value={form.watch(`signers.${index}.name`) ?? ""}
                          colleagues={colleagues}
                          onPick={pickInto(index)}
                          placeholder="María González"
                          aria-label="Nombre del firmante"
                        />
                      </Field>
                      <Field label="Correo" error={form.formState.errors.signers?.[index]?.email?.message}>
                        <SignerAutocomplete
                          register={form.register(`signers.${index}.email`)}
                          value={form.watch(`signers.${index}.email`) ?? ""}
                          colleagues={colleagues}
                          onPick={pickInto(index)}
                          placeholder="maria@empresa.com"
                          aria-label="Correo del firmante"
                        />
                      </Field>
                      <Field label="Papel" htmlFor={`role-${index}`} className="sm:col-span-2 sm:max-w-xs">
                        <Select id={`role-${index}`} {...form.register(`signers.${index}.role`)}>
                          <option value="FIRMANTE">Firmante</option>
                          <option value="REVISOR">Revisor</option>
                        </Select>
                      </Field>
                    </div>
                  </li>
                ))}
              </ul>
              {form.formState.errors.signers?.message ? (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.signers.message}
                </p>
              ) : null}

              <Button type="button" variant="outline" onClick={() => append({ name: "", email: "", role: "FIRMANTE" })}>
                <Plus /> Añadir participante
              </Button>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background p-4">
                <div>
                  <p id="lbl-sequential" className="text-sm font-medium">
                    Orden secuencial
                  </p>
                  <p className="text-sm text-muted-foreground">Reciben el documento uno por uno, en el orden de arriba. Si lo apagas, todos lo reciben a la vez.</p>
                </div>
                <Switch aria-labelledby="lbl-sequential" checked={sequential} onCheckedChange={(checked) => form.setValue("sequential", checked)} />
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section aria-labelledby="paso-opciones" className="space-y-8">
              <div>
                <h2 id="paso-opciones" className="text-xl font-semibold">
                  ¿Cómo se va a firmar?
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Cada firmante elegirá uno de los métodos que autorices.</p>
              </div>

              <Field
                label="Partir de una plantilla"
                htmlFor="template"
                optional
                hint="Rellena métodos, orden, identidad, passkey y plazo. Lo que cambies aquí se envía tal cual."
              >
                <Select id="template" value={templateId} onChange={(event) => onPickTemplate(event.target.value)}>
                  <option value="">Sin plantilla</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">Métodos de firma autorizados</legend>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {ENVELOPE_METHOD_OPTIONS.map(({ value, label }) => {
                    const Icon = METHOD_ICONS[value];
                    const active = methods.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleMethod(value)}
                        className={cn(
                          "relative flex flex-col items-center gap-2 rounded-lg border p-4 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "border-foreground bg-accent" : "border-border bg-background hover:bg-muted",
                        )}
                      >
                        {active ? <Check className="absolute right-2 top-2 size-4" aria-hidden /> : null}
                        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                        <span className="text-sm font-medium">{label}</span>
                        <span className="sr-only">{active ? "(autorizado)" : "(no autorizado)"}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background p-4">
                <div>
                  <p id="lbl-passkey" className="text-sm font-medium">
                    Exigir passkey antes de firmar
                  </p>
                  <p className="text-sm text-muted-foreground">El firmante verifica presencia con su passkey, sin importar el método que elija.</p>
                </div>
                <Switch aria-labelledby="lbl-passkey" checked={requirePasskey} onCheckedChange={setRequirePasskey} />
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">Verificación de identidad (KYC)</legend>
                <p className="text-sm text-muted-foreground">Exige una verificación de identidad (INE + prueba de vida) vigente antes de firmar.</p>
                <div className="flex flex-wrap gap-2">
                  {KYC_OPTIONS.map(({ value, label }) => (
                    <Button key={value} type="button" size="sm" aria-pressed={kycPolicy === value} variant={kycPolicy === value ? "default" : "outline"} onClick={() => setKycPolicy(value)}>
                      {kycPolicy === value ? <Check /> : null}
                      {label}
                    </Button>
                  ))}
                </div>
              </fieldset>

              <Field label="Plazo para firmar (horas)" htmlFor="sla" className="max-w-40">
                <Input id="sla" type="number" min={1} max={2160} className="tabular-nums" value={slaHours} onChange={(event) => setSlaHours(Number(event.target.value) || 1)} />
              </Field>

              <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
                <Field label="Guardar esta configuración como plantilla" htmlFor="template-name" optional hint="La próxima vez podrás partir de ella.">
                  <Input id="template-name" placeholder="Nombre de la plantilla" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
                </Field>
                <Button type="button" variant="outline" disabled={savingTemplate} onClick={saveTemplate}>
                  {savingTemplate ? "Guardando…" : "Guardar plantilla"}
                </Button>
              </div>
            </section>
          ) : null}

          {step === last ? (
            <section aria-labelledby="paso-revisar" className="space-y-6">
              <div>
                <h2 id="paso-revisar" className="text-xl font-semibold">
                  Revisa antes de enviar
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Al enviar, cada participante recibe su enlace de firma.</p>
              </div>
              <SummaryList items={summary} onEdit={setStep} editable />
              {!summary.every((i) => i.done) ? (
                <p role="alert" className="flex items-start gap-2 text-sm">
                  <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden /> Completa lo que está pendiente para poder enviar.
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
            <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(s - 1, 0))} disabled={step === 0}>
              Atrás
            </Button>
            {step < last ? (
              <Button type="button" onClick={goNext}>
                Continuar
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={submitting || !summary.every((i) => i.done)}>
                {submitting ? "Enviando…" : "Enviar a firmar"}
              </Button>
            )}
          </div>
        </form>

        {step < last ? (
          <aside aria-label="Resumen del envío" className="hidden lg:block">
            <div className="sticky top-20 rounded-lg border border-border bg-background p-4">
              <h2 className="mb-3 text-base font-semibold">Resumen</h2>
              <SummaryList items={summary} />
            </div>
          </aside>
        ) : null}
      </div>
    </AppShell>
  );
}

interface SummaryItem {
  label: string;
  step: number;
  done: boolean;
  value: string;
  detail?: string;
}

/** Lista de lo que se enviará. Cada línea dice si está lista con icono y texto, no solo con color. */
function SummaryList({ items, onEdit, editable = false }: { items: SummaryItem[]; onEdit?: (step: number) => void; editable?: boolean }) {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border bg-background">
      {items.map((item) => (
        <div key={item.label} className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="mt-0.5 text-sm font-medium break-words">{item.value}</dd>
            {item.detail ? (
              <dd className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                {item.done ? <Check className="size-4" aria-hidden /> : <CircleDashed className="size-4" aria-hidden />}
                {item.detail}
              </dd>
            ) : null}
          </div>
          {editable && onEdit ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(item.step)} aria-label={`Cambiar ${item.label.toLowerCase()}`}>
              Cambiar
            </Button>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
