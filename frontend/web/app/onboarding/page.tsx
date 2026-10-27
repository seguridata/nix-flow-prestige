"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, CircleCheck, CircleX, UserPlus, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/documents/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { groupOnboarding, hasConsent, isClosed, nextAction, onboardingSteps, type OnboardingCaseView } from "@/libs/onboarding-flow";
import { cn } from "@/libs/utils";
import { apiClient } from "@/services/api-client";
import { buildOnboardingCreatePayload } from "@/services/payloads";

const KIND_TEXT: Record<string, string> = { EMPLEADO: "Empleado", PROVEEDOR: "Proveedor", CLIENTE: "Cliente" };

export default function OnboardingListPage() {
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => apiClient.get<OnboardingCaseView[]>("/onboarding"),
  });
  const groups = groupOnboarding(list.data);
  const empty = list.isSuccess && (list.data?.length ?? 0) === 0;

  return (
    <AppShell title="Altas de identidad">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Altas de identidad"
          description={
            list.isLoading
              ? "Cargando las altas…"
              : groups.action.length > 0
                ? `${groups.action.length === 1 ? "1 alta espera" : `${groups.action.length} altas esperan`} tu decisión. Van primero.`
                : "Antes de firmar, cada persona deja su consentimiento, su INE y una prueba de vida. RH revisa y decide si se habilita; esa decisión queda en la auditoría."
          }
          actions={
            <Button onClick={() => setOpen(true)}>
              <UserPlus /> Nueva alta
            </Button>
          }
        />

        {list.isLoading ? (
          <div className="space-y-3" aria-busy aria-label="Cargando altas">
            <div className="rounded-lg border-2 border-border p-5">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="mt-3 h-4 w-1/2" />
            </div>
            <div className="divide-y divide-border rounded-lg border border-border">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-4">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-6 w-24 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ) : list.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-5 text-sm">
            <span>No se pudieron cargar las altas.</span>
            <Button size="sm" variant="outline" onClick={() => list.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : empty ? (
          <EmptyState
            icon={<UserRoundCheck />}
            title="Todavía no hay altas"
            description="Inicia una para que una persona pueda firmar con identidad verificada. Te guiaremos con el consentimiento, la INE y la prueba de vida."
            action={
              <Button onClick={() => setOpen(true)}>
                <UserPlus /> Nueva alta
              </Button>
            }
          />
        ) : (
          <div className="space-y-9">
            <Group title="Requieren tu decisión" rows={groups.action} emphasis />
            <Group title="En captura" rows={groups.capture} />
            <Group title="Cerradas" rows={groups.closed} />
          </div>
        )}
      </div>

      <NewCaseDialog open={open} onOpenChange={setOpen} />
    </AppShell>
  );
}

function Group({ title, rows, emphasis = false }: { title: string; rows: OnboardingCaseView[]; emphasis?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title}>
      <h2 className="mb-3 flex items-baseline gap-2 text-base font-semibold">
        {title}
        <span className="text-sm font-normal tabular-nums text-muted-foreground">{rows.length}</span>
      </h2>
      <ul className={emphasis ? "space-y-3" : "divide-y divide-border overflow-hidden rounded-lg border border-border bg-background"}>
        {rows.map((row) => (
          <CaseRow key={row.id} row={row} emphasis={emphasis} />
        ))}
      </ul>
    </section>
  );
}

/** La acción siguiente como botón: «Revisar INE», «Habilitar», «Continuar captura» o «Ver alta». */
function rowCta(row: OnboardingCaseView): string {
  if (isClosed(row)) return "Ver alta";
  if (nextAction(row).needsRh) return row.ineVerified ? "Habilitar" : "Revisar INE";
  return hasConsent(row) ? "Continuar captura" : "Registrar consentimiento";
}

function CaseRow({ row, emphasis }: { row: OnboardingCaseView; emphasis: boolean }) {
  const steps = onboardingSteps(row);
  const done = steps.filter((s) => s.state === "done").length;
  const next = nextAction(row);
  const closed = isClosed(row);
  return (
    <li>
      <Link
        href={`/onboarding/${row.id}` as Route}
        className={cn(
          "group flex flex-col gap-3 bg-background outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:gap-4",
          emphasis ? "rounded-lg border-2 border-foreground p-4 shadow-subtle sm:p-5" : "min-h-16 px-4 py-3.5 focus-visible:ring-inset",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2">
            <span className={cn("truncate", emphasis ? "text-lg font-semibold" : "text-base font-medium")}>{row.fullName}</span>
            {row.username ? (
              <span className="shrink-0 font-mono text-sm text-muted-foreground" title="Usuario para entrar a Prestige">
                {row.username}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {KIND_TEXT[row.kind] ?? row.kind} · {row.email}
          </p>
          <p className={cn("mt-1.5 flex items-center gap-1.5 text-sm", next.needsRh ? "font-medium text-foreground" : "text-muted-foreground")}>
            {row.status === "HABILITADO" ? <CircleCheck className="size-4 shrink-0" aria-hidden /> : null}
            {row.status === "RECHAZADO" ? <CircleX className="size-4 shrink-0" aria-hidden /> : null}
            {next.sentence}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-2">
          <StatusBadge status={row.status} />
          {closed ? null : (
            <span className="text-sm tabular-nums text-muted-foreground">
              Paso {Math.min(done + 1, steps.length)} de {steps.length}
            </span>
          )}
        </div>
        <span
          aria-hidden
          className={cn(
            buttonVariants({ variant: emphasis ? "default" : "outline", size: emphasis ? "lg" : "default" }),
            "w-full shrink-0 sm:w-auto sm:min-w-36",
          )}
        >
          {rowCta(row)}
          <ChevronRight />
        </span>
      </Link>
    </li>
  );
}

function NewCaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    kind: "EMPLEADO" as "EMPLEADO" | "PROVEEDOR" | "CLIENTE",
    givenNames: "",
    lastName: "",
    secondLastName: "",
    email: "",
    curp: "",
    rfc: "",
  });
  // La casilla nunca viene marcada: el titular debe estar presente y aceptar por escrito.
  const [consent, setConsent] = useState(false);
  const notice = useQuery({
    queryKey: ["biometric-consent"],
    queryFn: () => apiClient.get<{ version: string; text: string }>("/onboarding/biometric-consent"),
    enabled: open,
  });
  const create = useMutation({
    mutationFn: () =>
      apiClient.post<OnboardingCaseView>(
        "/onboarding",
        buildOnboardingCreatePayload({
          ...form,
          fullName: [form.givenNames, form.lastName, form.secondLastName].map((part) => part.trim()).filter(Boolean).join(" "),
        }),
      ),
    onSuccess: (row) => {
      toast.success(
        row.username
          ? `Alta creada. Su usuario es ${row.username}. Continúa con la INE y la prueba de vida.`
          : "Alta creada. Continúa con la INE y la prueba de vida.",
      );
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      onOpenChange(false);
      router.push(`/onboarding/${row.id}` as Route);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo crear el alta"),
  });

  const ready =
    form.givenNames.trim().length >= 1 &&
    form.lastName.trim().length >= 1 &&
    /.+@.+\..+/.test(form.email) &&
    consent &&
    !!notice.data;

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nueva alta de identidad</DialogTitle>
          <DialogDescription>Datos de la persona y su consentimiento para tratar su INE y su biometría.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !create.isPending) create.mutate();
          }}
        >
          <Field label="Tipo de persona" htmlFor="alta-tipo">
            <Select id="alta-tipo" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}>
              {Object.entries(KIND_TEXT).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nombre(s)" htmlFor="alta-nombre">
            <Input id="alta-nombre" value={form.givenNames} onChange={(e) => setForm({ ...form, givenNames: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Primer apellido" htmlFor="alta-apellido">
              <Input id="alta-apellido" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </Field>
            <Field label="Segundo apellido" htmlFor="alta-apellido2" optional>
              <Input id="alta-apellido2" value={form.secondLastName} onChange={(e) => setForm({ ...form, secondLastName: e.target.value })} />
            </Field>
          </div>
          <Field label="Correo" htmlFor="alta-correo">
            <Input id="alta-correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CURP" htmlFor="alta-curp" optional>
              <Input id="alta-curp" value={form.curp} onChange={(e) => setForm({ ...form, curp: e.target.value })} />
            </Field>
            <Field label="RFC" htmlFor="alta-rfc" optional>
              <Input id="alta-rfc" value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value })} />
            </Field>
          </div>

          <fieldset className="rounded-lg border border-border bg-muted/40 p-3">
            <legend className="px-1 text-sm font-medium">Consentimiento, versión {notice.data?.version ?? "…"}</legend>
            <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">
              {notice.data?.text ?? "Cargando el texto del consentimiento…"}
            </p>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm leading-snug">
              <input
                type="checkbox"
                className="mt-0.5 size-6 shrink-0 accent-[var(--brand-carbon)]"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>El titular está presente y acepta por escrito el tratamiento de su biometría y de su INE.</span>
            </label>
          </fieldset>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={create.isPending} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? "Creando…" : "Iniciar alta"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
