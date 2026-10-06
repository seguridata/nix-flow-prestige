"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Fingerprint, KeyRound, PenTool, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <AppShell
      title="Plantillas"
      actions={
        <Button asChild>
          <Link href="/new">Nuevo envío</Link>
        </Button>
      }
    >
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-3">
          {isLoading ? <p className="text-sm text-muted-foreground">Cargando plantillas…</p> : null}
          {!isLoading && (templates?.length ?? 0) === 0 ? (
            <Card className="p-7">
              <p className="text-sm font-medium text-foreground">Todavía no hay plantillas</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Una plantilla guarda el orden, los métodos, la política de identidad, la passkey y el
                plazo. Al enviar un documento la eliges y partes de ahí.
              </p>
            </Card>
          ) : null}
          {templates?.map((template) => (
            <Card key={template.id} className="gap-2 p-5">
              <p className="text-sm font-semibold text-foreground">{template.name}</p>
              <p className="text-xs text-muted-foreground">
                {template.order === "SECUENCIAL" ? "Orden secuencial" : "Orden paralelo"} ·{" "}
                {KYC_LABEL[template.kycPolicy]} · {template.slaHours} h
                {template.requirePasskey ? " · passkey obligatoria" : ""}
              </p>
              <p className="text-sm text-foreground">
                {template.allowedMethods
                  .map((method) => ENVELOPE_METHOD_OPTIONS.find((option) => option.value === method)?.label ?? method)
                  .join(", ")}
              </p>
            </Card>
          ))}
        </div>

        <Card className="h-fit gap-5 p-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Nueva plantilla</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              El nombre es único en el tenant. Para cambiar una, crea otra.
            </p>
          </div>
          <div>
            <Label htmlFor="tpl-name">Nombre</Label>
            <Input id="tpl-name" className="mt-2" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {ENVELOPE_METHOD_OPTIONS.map(({ value, label }) => {
              const Icon = METHOD_ICONS[value];
              const active = methods.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleMethod(value)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                    active ? "border-primary bg-accent" : "border-border hover:bg-muted",
                  )}
                >
                  <Icon className="size-4 text-primary" strokeWidth={1.75} />
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-foreground">Orden secuencial</p>
            <Switch checked={sequential} onCheckedChange={setSequential} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-foreground">Exigir passkey</p>
            <Switch checked={requirePasskey} onCheckedChange={setRequirePasskey} />
          </div>
          <div className="flex flex-wrap gap-2">
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
          <div>
            <Label htmlFor="tpl-sla">Plazo (horas)</Label>
            <Input
              id="tpl-sla"
              type="number"
              min={1}
              max={2160}
              className="mt-2 w-32"
              value={slaHours}
              onChange={(event) => setSlaHours(Number(event.target.value) || 1)}
            />
          </div>
          <Button type="button" disabled={save.isPending} onClick={onCreate}>
            {save.isPending ? "Guardando…" : "Crear plantilla"}
          </Button>
        </Card>
      </div>
    </AppShell>
  );
}
