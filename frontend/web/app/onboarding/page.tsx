"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/documents/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { groupOnboarding, isClosed, nextAction, onboardingSteps, type OnboardingCaseView } from "@/libs/onboarding-flow";
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
    <AppShell
      title="Onboarding"
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          <UserPlus /> Nueva alta
        </Button>
      }
    >
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Altas de identidad</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Antes de firmar, cada persona deja su consentimiento, su INE y una prueba de vida. RH revisa y decide si se
            habilita; esa decisión queda en la auditoría.
          </p>
        </header>

        {list.isLoading ? (
          <div className="space-y-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : list.isError ? (
          <div role="alert" className="rounded-lg border border-border p-6 text-sm">
            No se pudieron cargar las altas.{" "}
            <Button variant="link" onClick={() => list.refetch()}>
              Reintentar
            </Button>
          </div>
        ) : empty ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <p className="text-base font-medium">Todavía no hay altas</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Inicia una para que una persona pueda firmar con identidad verificada.
            </p>
            <Button className="mt-4" onClick={() => setOpen(true)}>
              <UserPlus /> Nueva alta
            </Button>
          </div>
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
        <span className="text-sm font-normal text-muted-foreground">{rows.length}</span>
      </h2>
      <ul className="space-y-2">
        {rows.map((row) => (
          <CaseRow key={row.id} row={row} emphasis={emphasis} />
        ))}
      </ul>
    </section>
  );
}

function CaseRow({ row, emphasis }: { row: OnboardingCaseView; emphasis: boolean }) {
  const steps = onboardingSteps(row);
  const done = steps.filter((s) => s.state === "done").length;
  const next = nextAction(row);
  return (
    <li>
      <Link
        href={`/onboarding/${row.id}` as Route}
        className={cn(
          "group flex items-center gap-4 rounded-lg border bg-background px-4 py-3.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
          emphasis ? "border-2 border-foreground" : "border-border",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium">{row.fullName}</p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {KIND_TEXT[row.kind] ?? row.kind} · {row.email}
          </p>
          <p className={cn("mt-1.5 text-sm", next.needsRh ? "font-medium text-foreground" : "text-muted-foreground")}>
            {next.sentence}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge status={row.status} />
          {isClosed(row) ? null : (
            <span className="text-xs tabular-nums text-muted-foreground">
              {done} de {steps.length} pasos
            </span>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

function NewCaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    kind: "EMPLEADO" as "EMPLEADO" | "PROVEEDOR" | "CLIENTE",
    fullName: "",
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
    mutationFn: () => apiClient.post<OnboardingCaseView>("/onboarding", buildOnboardingCreatePayload(form)),
    onSuccess: (row) => {
      toast.success("Alta creada. Continúa con la INE y la prueba de vida.");
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      onOpenChange(false);
      router.push(`/onboarding/${row.id}` as Route);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo crear el alta"),
  });

  const ready = form.fullName.trim().length >= 3 && /.+@.+\..+/.test(form.email) && consent && !!notice.data;

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
          <div>
            <Label htmlFor="alta-tipo">Tipo</Label>
            <select
              id="alta-tipo"
              className="mt-1.5 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
            >
              {Object.entries(KIND_TEXT).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="alta-nombre">Nombre completo</Label>
            <Input id="alta-nombre" className="mt-1.5" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="alta-correo">Correo</Label>
            <Input id="alta-correo" className="mt-1.5" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="alta-curp">CURP (opcional)</Label>
              <Input id="alta-curp" className="mt-1.5" value={form.curp} onChange={(e) => setForm({ ...form, curp: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="alta-rfc">RFC (opcional)</Label>
              <Input id="alta-rfc" className="mt-1.5" value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value })} />
            </div>
          </div>

          <fieldset className="rounded-lg border border-border bg-muted/40 p-3">
            <legend className="px-1 text-sm font-medium">Consentimiento, versión {notice.data?.version ?? "…"}</legend>
            <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">
              {notice.data?.text ?? "Cargando el texto del consentimiento…"}
            </p>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm leading-snug">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-[var(--brand-carbon)]"
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
