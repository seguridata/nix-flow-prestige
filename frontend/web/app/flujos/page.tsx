"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, Plus } from "lucide-react";
import { toast } from "sonner";

import { BpmnViewer } from "@/components/bpm/bpmn-viewer";
import { FlowEditor } from "@/components/formats/flow-editor";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describeWhen, describeWho, emptyFlow, flowProblems, type Flow } from "@/libs/flow";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";
import {
  createFlowDefinition,
  fetchFlowDefinitions,
  saveFlowDefinition,
  setFlowPublished,
  type FlowDefinition,
} from "@/services/formats-service";

/** Una fila por flujo: su última versión y cuál (si alguna) está publicada. */
interface FlowRow {
  key: string;
  latest: FlowDefinition;
  published: FlowDefinition | null;
}

function groupFlows(defs: FlowDefinition[]): FlowRow[] {
  const byKey = new Map<string, FlowDefinition[]>();
  for (const d of defs) if (d.flow) byKey.set(d.key, [...(byKey.get(d.key) ?? []), d]);
  return [...byKey.entries()]
    .map(([key, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      return { key, latest: sorted[0]!, published: sorted.find((v) => v.published) ?? null };
    })
    .sort((a, b) => a.latest.name.localeCompare(b.latest.name, "es-MX"));
}

export default function FlujosPage() {
  const { roles } = useSession();
  const isAdmin = roles.includes("admin");
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const flows = useQuery({ queryKey: ["flows"], queryFn: () => fetchFlowDefinitions(), enabled: isAdmin });
  const rows = useMemo(() => groupFlows(flows.data ?? []), [flows.data]);

  return (
    <AppShell title="Flujos de aprobación">
      {!isAdmin ? (
        <p className="max-w-md text-sm text-muted-foreground">
          Solo el administrador puede crear y publicar flujos. Los flujos publicados aparecen al usar un formato.
        </p>
      ) : editing ? (
        <FlowDetail
          key={editing}
          row={editing === "new" ? null : (rows.find((r) => r.key === editing) ?? null)}
          onBack={() => setEditing(null)}
          onCreated={(key) => setEditing(key)}
        />
      ) : (
        <div className="max-w-3xl">
          <div className="mb-5 flex items-start justify-between gap-4">
            <p className="max-w-lg text-sm text-muted-foreground">
              Un flujo define a quién se envía un documento, en qué orden y con qué condiciones. Al publicarlo queda
              disponible para todos los formatos.
            </p>
            <Button onClick={() => setEditing("new")}>
              <Plus /> Nuevo flujo
            </Button>
          </div>

          {flows.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
            </div>
          ) : flows.isError ? (
            <div role="alert" className="rounded-lg border border-border p-5 text-sm">
              No se pudieron cargar los flujos.{" "}
              <Button variant="link" onClick={() => flows.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-14 text-center">
              <GitBranch className="size-8 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-base font-medium">Aún no hay flujos</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Crea el primero, por ejemplo «Autorización de vacaciones»: quien solicita, su jefe y, si son más de cinco días, RH.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => setEditing(r.key)}
                    className="flex w-full items-center gap-4 rounded-lg border border-border p-4 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-medium">{r.latest.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {r.latest.flow!.steps.length} {r.latest.flow!.steps.length === 1 ? "paso" : "pasos"}
                        {r.latest.description ? ` · ${r.latest.description}` : ""}
                      </span>
                    </span>
                    <StatusPill row={r} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AppShell>
  );
}

function StatusPill({ row }: { row: FlowRow }) {
  const draftNewer = !row.latest.published;
  return (
    <span className="flex shrink-0 flex-col items-end gap-1 text-xs">
      <span
        className={cn(
          "rounded-full border px-2.5 py-0.5 font-medium",
          row.published ? "border-foreground" : "border-border text-muted-foreground",
        )}
      >
        {row.published ? `Publicado · v${row.published.version}` : "Sin publicar"}
      </span>
      {draftNewer && row.published ? <span className="text-muted-foreground">Hay un borrador v{row.latest.version}</span> : null}
    </span>
  );
}

function FlowDetail({
  row,
  onBack,
  onCreated,
}: {
  row: FlowRow | null;
  onBack: () => void;
  onCreated: (key: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(row?.latest.name ?? "");
  const [description, setDescription] = useState(row?.latest.description ?? "");
  const [flow, setFlow] = useState<Flow>(row?.latest.flow ?? emptyFlow());
  const [saved, setSaved] = useState<FlowDefinition | null>(row?.latest ?? null);
  const [dirty, setDirty] = useState(!row);

  const problems = flowProblems(flow);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["flows"] });

  const save = useMutation({
    mutationFn: () =>
      saved
        ? saveFlowDefinition(saved.key, { name: name.trim(), description: description.trim() || undefined, flow })
        : createFlowDefinition({ name: name.trim(), description: description.trim() || undefined, flow }),
    onSuccess: async (def) => {
      const wasNew = !saved;
      setSaved(def);
      setDirty(false);
      toast.success(wasNew ? "Flujo creado como borrador." : `Se guardó la versión ${def.version} como borrador.`);
      await refresh();
      if (wasNew) onCreated(def.key);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publish = useMutation({
    mutationFn: (next: boolean) => setFlowPublished(saved!.key, saved!.version, next),
    onSuccess: async (def) => {
      setSaved(def);
      toast.success(def.published ? "Flujo publicado: ya está disponible para todos." : "Flujo despublicado.");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const canSave = name.trim().length >= 3 && problems.length === 0 && dirty && !save.isPending;

  return (
    <div className="grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="space-y-6">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Todos los flujos
        </button>

        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Nombre del flujo</span>
            <Input value={name} maxLength={120} placeholder="Ej. Autorización de vacaciones" onChange={(e) => touch(setName)(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Descripción (opcional)</span>
            <Input value={description} maxLength={300} onChange={(e) => touch(setDescription)(e.target.value)} />
          </label>
        </div>

        <FlowEditor value={flow} onChange={touch(setFlow)} />

        {problems.length > 0 ? (
          <ul role="status" className="space-y-1 rounded-md border border-border bg-muted/50 p-3 text-sm">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <Button disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando…" : saved ? "Guardar como nueva versión" : "Crear flujo"}
          </Button>
          {saved ? (
            saved.published ? (
              <Button variant="outline" disabled={publish.isPending || dirty} onClick={() => publish.mutate(false)}>
                Despublicar
              </Button>
            ) : (
              <Button variant="outline" disabled={publish.isPending || dirty} onClick={() => publish.mutate(true)}>
                Publicar v{saved.version} para todos
              </Button>
            )
          ) : null}
          {dirty && saved ? <span className="text-sm text-muted-foreground">Guarda los cambios para poder publicar.</span> : null}
        </div>
      </div>

      <aside aria-label="Vista previa" className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <h2 className="text-base font-semibold">Así se ejecuta</h2>
        <ol className="space-y-2">
          {flow.steps.map((s, i) => (
            <li key={s.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">
                {i + 1}. {s.label || "Paso sin nombre"}
              </p>
              <p className="text-muted-foreground">
                {s.role === "REVISOR" ? "Revisa" : "Firma"}: {describeWho(s.who)}
              </p>
              <p className="text-xs text-muted-foreground">{describeWhen(s.when, flow.variables)}</p>
            </li>
          ))}
        </ol>
        {saved?.bpmnXml && !dirty ? (
          <div>
            <h3 className="mb-2 text-sm font-medium">Diagrama BPMN de la versión {saved.version}</h3>
            <BpmnViewer xml={saved.bpmnXml} className="h-64 w-full overflow-hidden rounded-md border border-border bg-white" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">El diagrama BPMN se genera al guardar.</p>
        )}
      </aside>
    </div>
  );
}
