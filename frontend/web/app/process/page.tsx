"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { BpmnStudio } from "@/components/bpm/bpmn-studio";
import { DmnStudio } from "@/components/bpm/dmn-studio";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/services/api-client";
import { cn } from "@/libs/utils";
import { Group, Panel, Separator as ResizeSeparator } from "react-resizable-panels";
import { Timeline } from "@/components/ui/timeline";

interface ProcessDef {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  version: number;
  bpmnXml: string;
  dmnXml?: string | null;
}

interface WorkflowRun {
  id: string;
  signatureRequestId: string;
  workflowId: string;
  processKey: string;
  status: string;
  lastError?: string | null;
  createdAt: string;
}

type Tab = "diagrama" | "decisiones" | "instancias" | "catalogo";

export default function ProcessPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("diagrama");
  const [selectedKey, setSelectedKey] = useState("contrato-dos-partes");
  const [tipo, setTipo] = useState("contrato");
  const [saveFn, setSaveFn] = useState<(() => Promise<string>) | null>(null);

  const defs = useQuery({
    queryKey: ["process-definitions"],
    queryFn: () => apiClient.get<ProcessDef[]>("/process-definitions"),
  });
  const selected = defs.data?.find((d) => d.key === selectedKey) ?? defs.data?.[0];
  const runs = useQuery({
    queryKey: ["workflow-runs"],
    queryFn: () => apiClient.get<WorkflowRun[]>("/workflows"),
  });
  const decide = useMutation({
    mutationFn: () =>
      apiClient.post<{ slaHours: number; order: string; tipo: string }>(
        `/process-definitions/${selectedKey}/decide`,
        { tipo },
      ),
    onSuccess: (r) => toast.success(`SLA ${r.slaHours} h · orden ${r.order}`),
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!saveFn) throw new Error("El modeler aún no está listo");
      const bpmnXml = await saveFn();
      return apiClient.put(`/process-definitions/${selected?.key}`, { bpmnXml });
    },
    onSuccess: () => {
      toast.success("Nueva versión del proceso publicada.");
      queryClient.invalidateQueries({ queryKey: ["process-definitions"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo guardar"),
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "diagrama", label: "Diagrama BPMN" },
    { id: "decisiones", label: "Decisiones DMN" },
    { id: "instancias", label: "Instancias" },
    { id: "catalogo", label: "Catálogo" },
  ];

  return (
    <AppShell title="Proceso BPM">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{selected?.name ?? "Proceso"}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Modeler bpmn-js + simulación de tokens. El motor de ejecución es Temporal; este
              diagrama es el contrato de negocio. Workflow no firma.
            </p>
          </div>
          <div className="flex gap-2">
            <select
              className="h-11 rounded-md border border-border bg-background px-3 text-sm"
              value={selected?.key ?? selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
            >
              {(defs.data ?? []).map((d) => (
                <option key={d.id} value={d.key}>
                  {d.name} · v{d.version}
                </option>
              ))}
            </select>
            {tab === "diagrama" ? (
              <Button onClick={() => save.mutate()} disabled={save.isPending || !saveFn}>
                {save.isPending ? "Publicando…" : "Publicar versión"}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex gap-1 border-b border-border">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "px-4 py-2 text-sm",
                tab === item.id ? "border-b-2 border-primary font-medium" : "text-muted-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "diagrama" ? (
          <Card className="mt-4 overflow-hidden p-0">
            {selected?.bpmnXml ? (
              <Group
                orientation="horizontal"
                className="h-[68vh] w-full"
                defaultLayout={{ diagram: 72, inspector: 28 }}
              >
                <Panel id="diagram" minSize="40%">
                  <BpmnStudio xml={selected.bpmnXml} onReady={(fn) => setSaveFn(() => fn)} />
                </Panel>
                <ResizeSeparator className="w-1 bg-border hover:bg-primary/40" />
                <Panel id="inspector" minSize="18%" className="hidden overflow-auto bg-muted/40 p-4 lg:block">
                  <h2 className="text-sm font-semibold">Inspector</h2>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {selected.description} · v{selected.version}
                  </p>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Simula tokens con el control del visor. Publicar guarda una versión nueva en Postgres.
                  </p>
                  <Timeline
                    items={[
                      { id: "1", title: "Solicitud", meta: "Start" },
                      { id: "2", title: "Firmas", meta: "User tasks" },
                      { id: "3", title: "Evidencia", meta: "Service task" },
                    ]}
                  />
                </Panel>
              </Group>
            ) : (
              <div className="h-[68vh] animate-pulse bg-muted" />
            )}
          </Card>
        ) : null}

        {tab === "decisiones" ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
            <Card className="overflow-hidden p-0">
              {selected?.dmnXml ? <DmnStudio xml={selected.dmnXml} /> : <div className="h-64 bg-muted" />}
            </Card>
            <Card className="glass p-5">
              <h2 className="text-sm font-semibold">Evaluar tabla</h2>
              <p className="mt-1 text-xs text-muted-foreground">Hit policy FIRST. tipo → SLA y orden.</p>
              <Input className="mt-3" value={tipo} onChange={(e) => setTipo(e.target.value)} />
              <Button className="mt-3 w-full" onClick={() => decide.mutate()} disabled={decide.isPending}>
                Evaluar
              </Button>
              {decide.data ? (
                <p className="mt-3 font-mono text-sm">
                  {decide.data.slaHours} h · {decide.data.order}
                </p>
              ) : null}
            </Card>
          </div>
        ) : null}

        {tab === "instancias" ? (
          <Card className="mt-4 overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Proceso</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Solicitud</th>
                  <th className="px-4 py-3">Creado</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).map((run) => (
                  <tr key={run.id} className="border-t border-border">
                    <td className="px-4 py-3 font-mono text-xs">{run.processKey}</td>
                    <td className="px-4 py-3">{run.status}</td>
                    <td className="px-4 py-3 font-mono text-xs">{run.signatureRequestId.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString("es-MX")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}

        {tab === "catalogo" ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {(defs.data ?? []).map((d) => (
              <Card key={d.id} className="glass p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{d.key}</p>
                <h2 className="mt-2 text-lg font-semibold">{d.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{d.description}</p>
                <p className="mt-4 font-mono text-xs">v{d.version}</p>
                <Button className="mt-4" variant="outline" size="sm" onClick={() => { setSelectedKey(d.key); setTab("diagrama"); }}>
                  Abrir diagrama
                </Button>
              </Card>
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
