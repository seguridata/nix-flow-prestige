"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, CheckCircle2, FileStack, Fingerprint, KeyRound, PenTool, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  ENVELOPE_METHOD_OPTIONS,
  KYC_OPTIONS,
  draftToTemplateBody,
  type KycPolicy,
} from "@/libs/envelope-template";
import type { SignatureMethod } from "@/libs/types";
import { cn } from "@/libs/utils";
import { createEnvelopeTemplate, fetchEnvelopeTemplates } from "@/services/signature-requests-service";

const METHOD_ICONS = {
  DIGITAL: ShieldCheck,
  AUTOGRAFA: PenTool,
  BIOMETRICA: Fingerprint,
  ACCEPT: CheckCircle2,
  PASSKEY: KeyRound,
} as const;

const KYC_LABEL: Record<KycPolicy, string> = {
  NONE: "Sin verificación",
  ONCE: "Una vez (≤90 días)",
  EVERY_SIGN: "Cada firma",
};

export default function PlantillasPage() {
  const queryClient = useQueryClient();
  const { data: templates, isLoading } = useQuery({
    queryKey: ["envelope-templates"],
    queryFn: fetchEnvelopeTemplates,
  });

  const [name, setName] = useState("");
  const [methods, setMethods] = useState<SignatureMethod[]>(["DIGITAL"]);
  const [sequential, setSequential] = useState(true);
  const [kycPolicy, setKycPolicy] = useState<KycPolicy>("NONE");
  const [requirePasskey, setRequirePasskey] = useState(false);
  const [slaHours, setSlaHours] = useState(72);

  const save = useMutation({
    mutationFn: () =>
      createEnvelopeTemplate(
        draftToTemplateBody(name, { methods, sequential, kycPolicy, requirePasskey, slaHours }),
      ),
    onSuccess: async () => {
      toast.success("Plantilla creada.");
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["envelope-templates"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la plantilla.");
    },
  });

  function toggleMethod(method: SignatureMethod) {
    setMethods((prev) => (prev.includes(method) ? prev.filter((item) => item !== method) : [...prev, method]));
  }

  function onCreate() {
    if (name.trim().length < 1) {
      toast.error("Ponle un nombre a la plantilla.");
      return;
    }
    if (methods.length === 0) {
      toast.error("Autoriza al menos un método.");
      return;
    }
    save.mutate();
  }

  return (
    <AppShell title="Plantillas">
      <PageHeader
        title="Plantillas de envío"
        description="Una plantilla guarda el orden, los métodos de firma, la verificación de identidad y el plazo. Al enviar un documento la eliges y partes de ahí."
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="tpl-lista" className="min-w-0">
          <h2 id="tpl-lista" className="mb-3 text-lg font-semibold">
            Tus plantillas
          </h2>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-24 rounded-lg" />
            </div>
          ) : (templates?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<FileStack />}
              title="Todavía no hay plantillas"
              description="Crea la primera con el formulario. Después aparecerá aquí con la acción Usar."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {templates?.map((template) => (
                <li key={template.id} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-base font-medium">{template.name}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {template.order === "SECUENCIAL" ? "Orden secuencial" : "Orden paralelo"} · {KYC_LABEL[template.kycPolicy]} ·{" "}
                      <span className="tabular-nums">{template.slaHours} h</span>
                      {template.requirePasskey ? " · passkey obligatoria" : ""}
                    </p>
                    <p className="mt-1 text-sm">
                      {template.allowedMethods
                        .map((method) => ENVELOPE_METHOD_OPTIONS.find((option) => option.value === method)?.label ?? method)
                        .join(", ")}
                    </p>
                  </div>
                  <Button asChild variant="outline" className="shrink-0">
                    <Link href={`/new?plantilla=${encodeURIComponent(template.id)}` as never} aria-label={`Usar la plantilla ${template.name}`}>
                      Usar <ArrowRight />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="tpl-nueva" className="h-fit space-y-5 rounded-lg border border-border bg-background p-5 lg:sticky lg:top-20">
          <div>
            <h2 id="tpl-nueva" className="text-lg font-semibold">
              Nueva plantilla
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">El nombre es único. Para cambiar una plantilla, crea otra con otro nombre.</p>
          </div>
          <Field label="Nombre" htmlFor="tpl-name">
            <Input id="tpl-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Métodos de firma</legend>
            <div className="grid grid-cols-2 gap-2">
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
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "border-foreground bg-accent font-medium" : "border-border hover:bg-muted",
                    )}
                  >
                    {active ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" strokeWidth={1.75} aria-hidden />}
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex items-center justify-between gap-3">
            <p id="tpl-seq" className="text-sm">
              Orden secuencial
            </p>
            <Switch aria-labelledby="tpl-seq" checked={sequential} onCheckedChange={setSequential} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p id="tpl-pk" className="text-sm">
              Exigir passkey
            </p>
            <Switch aria-labelledby="tpl-pk" checked={requirePasskey} onCheckedChange={setRequirePasskey} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Verificación de identidad</legend>
            <div className="flex flex-wrap gap-2">
              {KYC_OPTIONS.map(({ value, label }) => (
                <Button key={value} type="button" size="sm" aria-pressed={kycPolicy === value} variant={kycPolicy === value ? "default" : "outline"} onClick={() => setKycPolicy(value)}>
                  {kycPolicy === value ? <Check /> : null}
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
          <Field label="Plazo (horas)" htmlFor="tpl-sla" className="max-w-40">
            <Input id="tpl-sla" type="number" min={1} max={2160} className="tabular-nums" value={slaHours} onChange={(event) => setSlaHours(Number(event.target.value) || 1)} />
          </Field>
          <Button type="button" className="w-full" disabled={save.isPending} onClick={onCreate}>
            {save.isPending ? "Guardando…" : "Crear plantilla"}
          </Button>
        </section>
      </div>
    </AppShell>
  );
}
