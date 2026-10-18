"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, Fingerprint, KeyRound, PenTool, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const STEPS = ["Documento", "Firmantes", "Método y envío"] as const;

export default function NewSignatureRequestPage() {
  const router = useRouter();
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

  return (
    <AppShell title="Nuevo envío">
      <div className="mx-auto max-w-2xl">
        <div className="mb-10 flex items-center gap-3">
          {STEPS.map((label, index) => (
            <div key={label} className="flex flex-1 items-center gap-3">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  index <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {index + 1}
              </div>
              <span
                className={cn(
                  "text-sm font-medium",
                  index === step ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              {index < STEPS.length - 1 ? (
                <div className="mx-1 h-px flex-1 bg-border" />
              ) : null}
            </div>
          ))}
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <AnimatePresence mode="wait">
            {step === 0 ? (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25 }}
              >
                <Card className="gap-6 p-7">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      ¿Qué documento vas a enviar a firmar?
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Dale un título claro y adjunta el PDF.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="title">Título del documento</Label>
                    <Input
                      id="title"
                      placeholder="Contrato de arrendamiento - Sucursal Polanco"
                      {...form.register("title")}
                    />
                    {form.formState.errors.title ? (
                      <p className="text-xs text-destructive">
                        {form.formState.errors.title.message}
                      </p>
                    ) : null}
                  </div>

                  <label
                    htmlFor="pdf-upload"
                    className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-6 py-10 text-center transition-colors hover:bg-muted"
                  >
                    <Upload className="size-6 text-muted-foreground" strokeWidth={1.5} />
                    <span className="text-sm font-medium text-foreground">
                      {file ? file.name : "Arrastra o selecciona un PDF"}
                    </span>
                    <span className="text-xs text-muted-foreground">Solo archivos .pdf</span>
                    <input
                      id="pdf-upload"
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </Card>
              </motion.div>
            ) : null}

            {step === 1 ? (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25 }}
              >
                <Card className="gap-6 p-7">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      ¿Quién debe firmar o revisar este documento?
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Agrega a los participantes y define en qué orden.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3">
                    {fields.map((field, index) => (
                      <div
                        key={field.id}
                        className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-end"
                      >
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-foreground">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <Label className="mb-1 block text-xs">Nombre</Label>
                          <SignerAutocomplete
                            register={form.register(`signers.${index}.name`)}
                            value={form.watch(`signers.${index}.name`) ?? ""}
                            colleagues={colleagues}
                            onPick={pickInto(index)}
                            placeholder="María González"
                            aria-label="Nombre del firmante"
                          />
                        </div>
                        <div className="flex-1">
                          <Label className="mb-1 block text-xs">Correo</Label>
                          <SignerAutocomplete
                            register={form.register(`signers.${index}.email`)}
                            value={form.watch(`signers.${index}.email`) ?? ""}
                            colleagues={colleagues}
                            onPick={pickInto(index)}
                            placeholder="maria@empresa.com"
                            aria-label="Correo del firmante"
                          />
                        </div>
                        <div>
                          <Label className="mb-1 block text-xs">Rol</Label>
                          <select
                            className="h-11 rounded-md border border-input bg-background px-3 text-sm"
                            {...form.register(`signers.${index}.role`)}
                          >
                            <option value="FIRMANTE">Firmante</option>
                            <option value="REVISOR">Revisor</option>
                          </select>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(index)}
                          disabled={fields.length === 1}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => append({ name: "", email: "", role: "FIRMANTE" })}
                    className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="size-4" /> Añadir participante
                  </button>

                  <div className="flex items-center justify-between rounded-md border border-border p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">Orden secuencial</p>
                      <p className="text-xs text-muted-foreground">
                        Los participantes reciben el documento uno por uno, respetando el orden de
                        arriba.
                      </p>
                    </div>
                    <Switch
                      checked={form.watch("sequential")}
                      onCheckedChange={(checked) => form.setValue("sequential", checked)}
                    />
                  </div>
                </Card>
              </motion.div>
            ) : null}

            {step === 2 ? (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.25 }}
              >
                <Card className="gap-6 p-7">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      ¿Qué métodos de firma autorizas?
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Cada firmante elegirá uno de estos al momento de firmar.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="template">Plantilla</Label>
                    <select
                      id="template"
                      value={templateId}
                      onChange={(event) => onPickTemplate(event.target.value)}
                      className="mt-2 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                    >
                      <option value="">Sin plantilla</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Elegir una plantilla rellena métodos, orden, identidad, passkey y plazo. Lo que
                      cambies aquí se envía tal cual.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {ENVELOPE_METHOD_OPTIONS.map(({ value, label }) => {
                      const Icon = METHOD_ICONS[value];
                      const active = methods.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleMethod(value)}
                          className={cn(
                            "flex flex-col items-center gap-2 rounded-md border p-5 text-center transition-colors",
                            active ? "border-primary bg-accent" : "border-border hover:bg-muted",
                          )}
                        >
                          <Icon className="size-5 text-primary" strokeWidth={1.75} />
                          <span className="text-sm font-medium text-foreground">{label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">Exigir passkey antes de firmar</p>
                      <p className="text-xs text-muted-foreground">
                        El firmante debe verificar presencia con su passkey, sin importar el método que
                        elija.
                      </p>
                    </div>
                    <Switch checked={requirePasskey} onCheckedChange={setRequirePasskey} />
                  </div>

                  <div className="rounded-md border border-border p-4">
                    <p className="text-sm font-medium text-foreground">Política de identidad (KYC)</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Exige una verificación de identidad (INE + prueba de vida) vigente antes de firmar.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {KYC_OPTIONS.map(({ value, label }) => (
                        <Button
                          key={value}
                          type="button"
                          size="sm"
                          variant={kycPolicy === value ? "default" : "outline"}
                          onClick={() => setKycPolicy(value)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-border p-4">
                    <Label htmlFor="sla">Plazo (horas)</Label>
                    <Input
                      id="sla"
                      type="number"
                      min={1}
                      max={2160}
                      className="mt-2 w-32"
                      value={slaHours}
                      onChange={(event) => setSlaHours(Number(event.target.value) || 1)}
                    />
                  </div>

                  <div className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <Label htmlFor="template-name">Guardar esta configuración</Label>
                      <Input
                        id="template-name"
                        className="mt-2"
                        placeholder="Nombre de la plantilla"
                        value={templateName}
                        onChange={(event) => setTemplateName(event.target.value)}
                      />
                    </div>
                    <Button type="button" variant="outline" disabled={savingTemplate} onClick={saveTemplate}>
                      {savingTemplate ? "Guardando…" : "Guardar plantilla"}
                    </Button>
                  </div>

                  <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Resumen</p>
                    <p className="mt-1">
                      {form.getValues("title") || "Sin título"} · {fields.length}{" "}
                      {fields.length === 1 ? "participante" : "participantes"} ·{" "}
                      {form.watch("sequential") ? "orden secuencial" : "orden paralelo"}
                    </p>
                  </div>

                  <Button type="submit" size="lg" disabled={submitting}>
                    {submitting ? "Enviando…" : "Enviar a firmar"}
                  </Button>
                </Card>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {step < STEPS.length - 1 ? (
            <div className="mt-6 flex justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep((s) => Math.max(s - 1, 0))}
                disabled={step === 0}
              >
                Atrás
              </Button>
              <Button type="button" onClick={goNext}>
                Continuar
              </Button>
            </div>
          ) : (
            <div className="mt-6">
              <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
                Atrás
              </Button>
            </div>
          )}
        </form>
      </div>
    </AppShell>
  );
}
