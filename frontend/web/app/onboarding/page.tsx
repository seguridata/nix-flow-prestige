"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/documents/status-badge";
import { useSession } from "@/store/session-store";
import { apiClient } from "@/services/api-client";

interface OnboardingRow {
  id: string;
  kind: string;
  status: string;
  fullName: string;
  email: string;
  ineVerified: boolean;
  livenessOk: boolean;
  enabledSignerId?: string | null;
  createdAt: string;
}

export default function OnboardingListPage() {
  const { signerId, name } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    kind: "EMPLEADO",
    fullName: "",
    email: "",
    curp: "",
    rfc: "",
  });
  const list = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => apiClient.get<OnboardingRow[]>("/onboarding"),
  });
  const create = useMutation({
    mutationFn: () =>
      apiClient.post<OnboardingRow>("/onboarding", {
        ...form,
        requestedBy: signerId,
        requestedByName: name,
      }),
    onSuccess: (row) => {
      toast.success("Alta creada. Continúa con INE y prueba de vida.");
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      router.push(`/onboarding/${row.id}`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo crear"),
  });

  return (
    <AppShell title="Onboarding">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[360px_1fr]">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">M16 · Identidad</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Alta de personas</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Datos, INE, prueba de vida y habilitación de firma. El motor biométrico se conecta si hay
            proveedor; si no, RH verifica en pantalla.
          </p>
          <Card className="mt-6 space-y-4 p-5">
            <div>
              <Label>Tipo</Label>
              <select
                className="mt-1.5 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
              >
                <option value="EMPLEADO">Empleado</option>
                <option value="PROVEEDOR">Proveedor</option>
                <option value="CLIENTE">Cliente</option>
              </select>
            </div>
            <div>
              <Label>Nombre</Label>
              <Input className="mt-1.5" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div>
              <Label>Correo</Label>
              <Input className="mt-1.5" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>CURP</Label>
              <Input className="mt-1.5" value={form.curp} onChange={(e) => setForm({ ...form, curp: e.target.value })} />
            </div>
            <div>
              <Label>RFC</Label>
              <Input className="mt-1.5" value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value })} />
            </div>
            <Button className="w-full" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Creando…" : "Iniciar alta"}
            </Button>
          </Card>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Expedientes</h2>
          <ul className="mt-4 space-y-3">
            {(list.data ?? []).map((row) => (
              <li key={row.id}>
                <Link href={`/onboarding/${row.id}`}>
                  <Card className="flex items-center justify-between p-4 hover:bg-muted/40">
                    <div>
                      <p className="font-medium">{row.fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.kind.toLowerCase()} · {row.email}
                        {row.ineVerified ? " · INE ok" : ""}
                        {row.livenessOk ? " · liveness ok" : ""}
                      </p>
                    </div>
                    <StatusBadge status={row.status} />
                  </Card>
                </Link>
              </li>
            ))}
            {(list.data ?? []).length === 0 ? (
              <Card className="p-8 text-sm text-muted-foreground">Aún no hay altas.</Card>
            ) : null}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
