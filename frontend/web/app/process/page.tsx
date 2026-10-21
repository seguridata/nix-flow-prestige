"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  History,
  MoreHorizontal,
  PencilLine,
  Plus,
  Search,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { BpmnStudio } from "@/components/process-studio/bpmn-studio";
import { DmnStudio } from "@/components/bpm/dmn-studio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { VerticalBuilder } from "@/components/process-studio/vertical-builder";
import {
  currentProcesses,
  type ProcessDefinition,
} from "@/components/process-studio/model";
import {
  ProcessLab,
  ImpactPanel,
} from "@/components/process-studio/process-tools";
import { apiClient } from "@/services/api-client";
import {
  createFlowDefinition,
  convertBpmnToFlow,
  saveFlowDefinition,
  setFlowPublished,
} from "@/services/formats-service";
import { emptyFlow, flowProblems, type Flow } from "@/libs/flow";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";

import { VersionHistory } from "@/components/process-studio/version-history";
import { RunMonitor } from "@/components/process-studio/run-monitor";

type Tab = "constructor" | "diagrama" | "seguimiento" | "decisiones" | "probar";
interface Preflight {
  ready: boolean;
  errors: string[];
  warnings: string[];
  checks: { key: string; label: string; status: string; detail: string }[];
}
const failure = (e: unknown) =>
  toast.error(
    e instanceof Error ? e.message : "No se pudo completar la operación.",
  );
const path = (key: string) => `/process-definitions/${encodeURIComponent(key)}`;

/** Estado de un proceso y su siguiente acción, en texto: nunca depende solo del color. */
function processStatus(d: ProcessDefinition) {
  if (!d.flow)
    return {
      badge: "Solo diagrama",
      variant: "warning" as const,
      Icon: CircleAlert,
      next: "Convertir en etapas",
    };
  if (d.publishedVersion == null)
    return {
      badge: "Borrador",
      variant: "neutral" as const,
      Icon: PencilLine,
      next: d.flow.steps.length ? "Revisar y publicar" : "Agregar etapas",
    };
  if (d.version > d.publishedVersion)
    return {
      badge: "Publicado, con cambios sin publicar",
      variant: "warning" as const,
      Icon: AlertTriangle,
      next: "Revisar y publicar",
    };
  return {
    badge: "Publicado",
    variant: "success" as const,
    Icon: CheckCircle2,
    next: "Usar en un formato",
  };
}

/** Botón «atrás» con el mismo aspecto del de PageHeader, pero con acción (confirma cambios sin guardar). */
function BackButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {children}
    </button>
  );
}

export default function ProcessPage() {
  const cache = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const { roles } = useSession();
  const admin = roles.includes("admin");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("todos");
  const defs = useQuery({
    queryKey: ["process-catalog"],
    queryFn: () => apiClient.get<ProcessDefinition[]>("/process-catalog"),
    enabled: admin,
  });
  const rows = useMemo(() => currentProcesses(defs.data ?? []), [defs.data]);
  const selected = rows.find((d) => d.key === selectedKey);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("process")) setSelectedKey(p.get("process"));
    if (p.get("new") === "1") setCreating(true);
  }, []);
  const refresh = () => {
    cache.invalidateQueries({ queryKey: ["process-catalog"] });
    cache.invalidateQueries({ queryKey: ["process-definitions"] });
    cache.invalidateQueries({ queryKey: ["flows"] });
  };
  const importPackage = useMutation({
    mutationFn: async (selectedFile: File) => {
      if (selectedFile.size > 2_000_000)
        throw new Error("El paquete debe pesar menos de 2 MB.");
      return apiClient.post<ProcessDefinition>(
        "/process-packages/import",
        JSON.parse(await selectedFile.text()),
      );
    },
    onSuccess: (d) => {
      refresh();
      setSelectedKey(d.key);
      toast.success("Paquete verificado e importado como borrador.");
    },
    onError: failure,
  });
  const visible = rows.filter(
    (d) =>
      `${d.name} ${d.description ?? ""}`
        .toLocaleLowerCase("es")
        .includes(search.toLocaleLowerCase("es")) &&
      (filter === "todos" ||
        (filter === "publicados"
          ? d.publishedVersion != null
          : d.publishedVersion == null)),
  );
  return (
    <AppShell title="Procesos de gastos">
      <main className="mx-auto w-full min-w-0 max-w-6xl selection:bg-primary/25">
        {!admin ? (
          <>
            <PageHeader
              title="Solicitudes y aprobaciones"
              description="El administrador prepara los procesos y publica sus flujos. Para enviar una solicitud, elige un formato disponible: su ruta de aprobación ya está configurada."
              actions={
                <Button asChild>
                  <Link href="/formatos">
                    Elegir formato
                    <ArrowRight />
                  </Link>
                </Button>
              }
            />
          </>
        ) : creating ? (
          <NewProcess
            onCancel={() => setCreating(false)}
            onCreated={(key) => {
              refresh();
              setCreating(false);
              setSelectedKey(key);
            }}
          />
        ) : selected ? (
          <ProcessDetail
            key={selected.key}
            definition={selected}
            admin={admin}
            onBack={() => setSelectedKey(null)}
            onRefresh={refresh}
            onArchived={() => {
              setSelectedKey(null);
              refresh();
            }}
          />
        ) : (
          <>
            <PageHeader
              title="Procesos"
              description="Diseña el proceso, publica su flujo y úsalo en una solicitud. Cada proceso aparece una sola vez; su historial vive dentro."
              actions={
                <>
                  <input
                    className="hidden"
                    type="file"
                    accept="application/json,.json"
                    ref={file}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importPackage.mutate(f);
                      e.target.value = "";
                    }}
                  />
                  <Button onClick={() => setCreating(true)}>
                    <Plus /> Crear proceso
                  </Button>
                  <Button
                    variant="outline"
                    disabled={importPackage.isPending}
                    onClick={() => file.current?.click()}
                  >
                    <Upload /> Importar
                  </Button>
                </>
              }
            />
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <label className="relative min-w-52 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  aria-label="Buscar procesos"
                  className="pl-10"
                  placeholder="Buscar proceso o subproceso…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="w-full sm:w-52">
                <Select
                  aria-label="Filtrar procesos"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="todos">Todos</option>
                  <option value="publicados">Publicados</option>
                  <option value="borradores">Borradores</option>
                </Select>
              </div>
            </div>
            {defs.isPending ? (
              <p role="status" className="py-12 text-sm text-muted-foreground">
                Cargando procesos…
              </p>
            ) : defs.isError ? (
              <div role="alert" className="py-10">
                <p>No pudimos cargar los procesos.</p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => defs.refetch()}
                >
                  Reintentar
                </Button>
              </div>
            ) : visible.length ? (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
                {visible.map((d) => {
                  const status = processStatus(d);
                  return (
                    <li key={d.key}>
                      <button
                        type="button"
                        className="group flex min-h-20 w-full items-center gap-4 px-4 py-4 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                        onClick={() => setSelectedKey(d.key)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <h2 className="break-words font-semibold">
                              {d.name}
                            </h2>
                            <Badge variant={status.variant}>
                              <status.Icon className="size-3.5" aria-hidden />
                              {status.badge}
                            </Badge>
                          </div>
                          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                            {d.description ||
                              "Define las etapas, responsables y condiciones de este proceso."}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {d.flow?.steps.length ?? 0} etapas ·{" "}
                            {d.versionCount ?? 1}{" "}
                            {(d.versionCount ?? 1) === 1
                              ? "versión"
                              : "versiones"}
                            {d.publishedVersion != null
                              ? ` · en uso v${d.publishedVersion}`
                              : ""}
                          </p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium">
                          <span className="hidden sm:inline">
                            {status.next}
                          </span>
                          <ChevronRight
                            className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                            aria-hidden
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={<Workflow />}
                title={
                  rows.length
                    ? "No hay coincidencias"
                    : "El siguiente proceso empieza aquí"
                }
                description={
                  rows.length
                    ? "Prueba otro nombre o cambia el filtro."
                    : "Crea las etapas de una solicitud de gastos o un subproceso de adquisición."
                }
                action={
                  rows.length ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSearch("");
                        setFilter("todos");
                      }}
                    >
                      Quitar filtros
                    </Button>
                  ) : (
                    <Button onClick={() => setCreating(true)}>
                      <Plus /> Crear proceso
                    </Button>
                  )
                }
              />
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}

function NewProcess({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (key: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () =>
      createFlowDefinition({
        name: name.trim(),
        description: description.trim(),
        flow: emptyFlow(),
      }),
    onSuccess: (d) => {
      toast.success("Proceso creado. Ahora configura sus etapas.");
      onCreated(d.key);
    },
    onError: failure,
  });
  return (
    <section className="max-w-xl">
      <BackButton onClick={onCancel}>Volver a procesos</BackButton>
      <PageHeader
        title="Crear proceso"
        description="Empieza con un nombre claro. Después definirás los datos y las aprobaciones."
        className="mb-6"
      />
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Nombre" htmlFor="proceso-nombre">
          <Input
            id="proceso-nombre"
            autoFocus
            required
            minLength={3}
            maxLength={120}
            placeholder="Ej. Solicitud de gastos de viaje"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="¿Para qué se usa?" htmlFor="proceso-uso" optional>
          <Textarea
            id="proceso-uso"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            disabled={create.isPending || name.trim().length < 3}
          >
            {create.isPending ? "Creando…" : "Crear y configurar etapas"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </section>
  );
}

type StepState = "done" | "current" | "pending";

/** Avance real del proceso: paso completado, actual y pendiente, con texto además de icono. */
function ProcessProgress({
  steps,
}: {
  steps: { id: string; label: string; state: StepState; href?: string; onNavigate?: (e: React.MouseEvent) => void }[];
}) {
  const stateText: Record<StepState, string> = {
    done: "Completado",
    current: "Paso actual",
    pending: "Pendiente",
  };
  return (
    <nav aria-label="Preparar el proceso">
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, i) => {
          const body = (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold",
                  step.state === "done" && "bg-primary text-primary-foreground",
                  step.state === "current" &&
                    "bg-secondary text-secondary-foreground",
                  step.state === "pending" && "bg-muted text-muted-foreground",
                )}
              >
                {step.state === "done" ? <Check className="size-4" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-sm",
                    step.state === "pending"
                      ? "text-muted-foreground"
                      : "font-semibold",
                  )}
                >
                  {step.label}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {stateText[step.state]}
                </span>
              </span>
            </>
          );
          const box = cn(
            "flex min-h-14 items-center gap-3 rounded-lg border px-4 py-2.5",
            step.state === "current"
              ? "border-foreground/40 bg-background"
              : "border-border bg-background",
          );
          return (
            <li
              key={step.id}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              {step.href ? (
                <Link
                  href={step.href as never}
                  onClick={step.onNavigate}
                  className={cn(
                    box,
                    "outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {body}
                  <ArrowRight
                    className="ml-auto size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              ) : (
                <div className={box}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ProcessDetail({
  definition: d,
  admin,
  onBack,
  onRefresh,
  onArchived,
}: {
  definition: ProcessDefinition;
  admin: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onArchived: () => void;
}) {
  const [tab, setTab] = useState<Tab>("constructor");
  const [history, setHistory] = useState(false);
  const [archive, setArchive] = useState(false);
  const [draft, setDraft] = useState<Flow | null>(d.flow ?? null);
  const [name, setName] = useState(d.name);
  const [saveXml, setSaveXml] = useState<(() => Promise<string>) | null>(null);
  const [xmlDirty, setXmlDirty] = useState(false);
  const [bpmnOpened, setBpmnOpened] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const flowDirty =
    JSON.stringify(draft) !== JSON.stringify(d.flow ?? null) || name !== d.name;
  const dirty = flowDirty || xmlDirty;
  useEffect(() => { if (tab === "diagrama") setBpmnOpened(true); }, [tab]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (
      ["constructor", "diagrama", "seguimiento", "probar"].includes(
        requested ?? "",
      )
    )
      setTab(requested as Tab);
  }, []);
  useEffect(() => {
    setDraft(d.flow ?? null);
    setName(d.name);
    setPreflight(null);
  }, [d.id, d.flow, d.name]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const saved = (message: string) => {
    toast.success(message);
    setPreflight(null);
    onRefresh();
  };
  const save = useMutation({
    mutationFn: () =>
      saveFlowDefinition(d.key, { name: name.trim(), flow: draft! }),
    onSuccess: () => { setXmlDirty(false); saved("Borrador guardado como nueva versión."); },
    onError: failure,
  });
  const validate = useMutation({
    mutationFn: () => apiClient.post<Preflight>(`${path(d.key)}/preflight`, draft ? { flow: draft } : {}),
    onSuccess: setPreflight,
    onError: failure,
  });
  const publish = useMutation({
    mutationFn: async () => {
      const result = await apiClient.post<Preflight>(
        `${path(d.key)}/preflight`,
        {},
      );
      setPreflight(result);
      if (!result.ready)
        throw new Error("Resuelve los puntos indicados antes de publicar.");
      return setFlowPublished(d.key, d.version, true);
    },
    onSuccess: () =>
      saved("Flujo publicado. Ya puedes asociarlo a un formato."),
    onError: failure,
  });
  const remove = useMutation({
    mutationFn: () => apiClient.delete(path(d.key)),
    onSuccess: () => {
      toast.success("Proceso retirado del catálogo. Su evidencia se conserva.");
      onArchived();
    },
    onError: failure,
  });
  const bpmn = useMutation({
    mutationFn: async () => {
      if (!saveXml) throw new Error("El diagrama todavía está cargando.");
      return apiClient.put(path(d.key), { bpmnXml: await saveXml() });
    },
    onSuccess: () => { setXmlDirty(false); saved("Diagrama guardado en una nueva versión."); },
    onError: failure,
  });
  const convert = useMutation({
    mutationFn: async () => {
      if (!saveXml) throw new Error("El diagrama todavía está cargando.");
      return convertBpmnToFlow(await saveXml(), draft?.variables);
    },
    onSuccess: (r) => {
      if (!r.flow) {
        toast.error(r.errors.join(" "));
        return;
      }
      setDraft(r.flow);
      setTab("constructor");
      toast.success(
        "Etapas extraídas. Revisa los responsables y guarda el borrador.",
      );
      if (r.warnings.length) toast.info(r.warnings.join(" "));
    },
    onError: failure,
  });
  const exportPackage = useMutation({
    mutationFn: () => apiClient.get<unknown>(`${path(d.key)}/export`),
    onSuccess: (data) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${d.key}-v${d.version}.prestige.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: failure,
  });
  const back = () => {
    if (
      dirty &&
      !window.confirm("Tienes cambios sin guardar. ¿Salir del proceso?")
    )
      return;
    onBack();
  };
  const confirmLeaveToFormats = (e: React.MouseEvent) => {
    if (dirty && !window.confirm("Tienes cambios sin guardar. ¿Ir a formatos?"))
      e.preventDefault();
  };
  const tabs: [Tab, string][] = [
    ["constructor", "Etapas y responsables"],
    ["probar", "Probar recorrido"],
    ["diagrama", "Diagrama avanzado"],
    ["seguimiento", "Solicitudes en ejecución"],
  ];
  if (!admin) tabs.splice(1, 1);
  if (d.dmnXml && !d.dmnXml.includes("Determinar SLA y orden"))
    tabs.push(["decisiones", "Tabla de decisiones"]);

  const hasSteps = (d.flow?.steps.length ?? 0) > 0;
  const isPublished =
    d.publishedVersion != null && d.version <= d.publishedVersion;
  const current = !hasSteps ? 0 : !isPublished ? 1 : 2;
  const stateOf = (i: number): StepState =>
    i < current ? "done" : i === current ? "current" : "pending";
  const formatsHref = `/formatos?flow=${encodeURIComponent(d.key)}`;
  const nextHelp = [
    "Agrega las etapas y sus responsables, y guarda el borrador.",
    dirty
      ? "Guarda tus cambios para poder publicar el flujo."
      : "Comprueba y publica el flujo para habilitarlo en formatos.",
    "El flujo está publicado. Asócialo a un formato para usarlo en solicitudes.",
  ][current];

  return (
    <>
      <BackButton onClick={back}>Todos los procesos</BackButton>
      <PageHeader
        className="mb-6"
        title={<span className="break-words">{d.name}</span>}
        description={
          d.description || "Configura la ruta que seguirá cada solicitud."
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span>Editando v{d.version}</span>
            <Badge variant={dirty ? "warning" : "neutral"}>
              {dirty ? (
                <AlertTriangle className="size-3.5" aria-hidden />
              ) : (
                <Check className="size-3.5" aria-hidden />
              )}
              {dirty ? "Cambios sin guardar" : "Guardada"}
            </Badge>
            <span>
              {d.publishedVersion
                ? `En uso: v${d.publishedVersion}`
                : "Aún sin publicar"}
            </span>
          </span>
        }
        actions={
          <>
            {current === 2 && admin ? (
              <Button asChild>
                <Link href={formatsHref as never} onClick={confirmLeaveToFormats}>
                  Asociar a un formato <ArrowRight />
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setHistory(true)}>
              <History /> Historial
            </Button>
            {admin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <MoreHorizontal /> Más
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={exportPackage.isPending}
                    onSelect={() => exportPackage.mutate()}
                  >
                    <Download /> Exportar paquete verificable
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setArchive(true)}>
                    <Trash2 /> Eliminar del catálogo
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      <ProcessProgress
        steps={[
          { id: "disenar", label: "Diseñar etapas", state: stateOf(0) },
          { id: "publicar", label: "Publicar flujo", state: stateOf(1) },
          {
            id: "usar",
            label: "Asociar a un formato y usar",
            state: stateOf(2),
            href: isPublished ? formatsHref : undefined,
            onNavigate: confirmLeaveToFormats,
          },
        ]}
      />
      <p className="mt-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Siguiente: </span>
        {nextHelp}
      </p>
      <div
        role="tablist"
        aria-label="Vistas del proceso"
        className="-mx-4 mt-6 flex overflow-x-auto border-b border-border px-4 [scrollbar-width:thin] sm:mx-0 sm:px-0"
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            id={`tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const index = tabs.findIndex(([key]) => key === id);
              const nextIndex =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (e.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              const next = tabs[nextIndex]![0];
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
            className={cn(
              "min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              tab === id
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="py-6"
      >
        {tab === "constructor" && (
          <>
            {draft ? (
              <>
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                  <Field
                    label="Nombre del proceso"
                    htmlFor="proceso-nombre-edicion"
                    className="w-full max-w-lg"
                  >
                    <Input
                      id="proceso-nombre-edicion"
                      disabled={!admin}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setPreflight(null);
                      }}
                    />
                  </Field>
                  {admin && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={validate.isPending}
                        onClick={() => validate.mutate()}
                      >
                        Comprobar
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          save.isPending ||
                          !flowDirty ||
                          name.trim().length < 3 ||
                          flowProblems(draft).length > 0
                        }
                        onClick={() => {
                          if (xmlDirty && !window.confirm("Guardar las etapas regenerará el diagrama y reemplazará sus cambios visuales sin guardar. ¿Continuar?")) return;
                          save.mutate();
                        }}
                      >
                        {save.isPending ? "Guardando…" : "Guardar borrador"}
                      </Button>
                      <Button
                        variant={d.published ? "outline" : "default"}
                        disabled={publish.isPending || dirty || !!d.published}
                        onClick={() => publish.mutate()}
                      >
                        {publish.isPending
                          ? "Comprobando…"
                          : d.published
                            ? "Publicado"
                            : "Publicar flujo"}
                      </Button>
                    </div>
                  )}
                </div>
                <VerticalBuilder
                  value={draft}
                  onChange={(flow) => {
                    setDraft(flow);
                    setPreflight(null);
                  }}
                  readOnly={!admin}
                />
              </>
            ) : (
              <EmptyState
                icon={<Workflow />}
                title="Este proceso todavía tiene solo un diagrama"
                description="Abre el diagrama y extrae sus etapas para convertirlo en un flujo ejecutable. Si contiene elementos incompatibles, te indicaremos cuáles debes ajustar."
                action={
                  <Button onClick={() => setTab("diagrama")}>
                    Abrir diagrama y preparar flujo
                    <ArrowRight />
                  </Button>
                }
              />
            )}
            {preflight && (
              <div
                className="mt-8 rounded-lg border border-border bg-background p-4 sm:p-5"
                role="status"
              >
                <h2 className="font-semibold">
                  {preflight.ready
                    ? "El flujo está listo para publicar"
                    : "Revisa estos puntos antes de publicar"}
                </h2>
                <ul className="mt-4 divide-y divide-border">
                  {preflight.checks.map((check) => (
                    <li className="py-3 text-sm" key={check.key}>
                      <p className="flex items-center gap-2 font-medium">
                        {check.status === "pass" ? (
                          <CheckCircle2 className="size-4 shrink-0" />
                        ) : check.status === "warn" ? (
                          <AlertTriangle className="size-4 shrink-0" />
                        ) : (
                          <CircleAlert className="size-4 shrink-0" />
                        )}
                        {check.label}
                        <span className="ml-auto shrink-0 text-sm font-normal text-muted-foreground">
                          {check.status === "pass"
                            ? "Correcto"
                            : check.status === "warn"
                              ? "Aviso"
                              : "Por resolver"}
                        </span>
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {check.detail}
                      </p>
                    </li>
                  ))}
                </ul>
                {[...preflight.errors, ...preflight.warnings].map((message) => (
                  <p key={message} className="mt-2 text-sm">
                    {message}
                  </p>
                ))}
              </div>
            )}
            {admin && <ImpactPanel processKey={d.key} />}
          </>
        )}
        {tab === "probar" &&
          admin &&
          (draft ? (
            <ProcessLab processKey={d.key} flow={draft} />
          ) : (
            <EmptyState
              icon={<Workflow />}
              title="Primero convierte el diagrama en etapas editables"
              description="El recorrido de prueba necesita un flujo con etapas."
              action={
                <Button variant="outline" onClick={() => setTab("diagrama")}>
                  Abrir diagrama
                </Button>
              }
            />
          ))}
        {(tab === "diagrama" || bpmnOpened) && (
          <div hidden={tab !== "diagrama"} aria-hidden={tab !== "diagrama"}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-sm text-muted-foreground">
                El diagrama muestra el proceso de negocio. Extraer etapas
                prepara un borrador editable; publicar el flujo habilita su uso
                en solicitudes.
              </p>
              {xmlDirty && <p role="status" className="text-sm font-medium">Diagrama con cambios sin guardar. Se conserva al cambiar de pestaña.</p>}
              {admin && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!saveXml || bpmn.isPending}
                    onClick={() => {
                      if (flowDirty && !window.confirm("Guardar el diagrama creará una versión sin flujo ejecutable. Las etapas sin guardar se reemplazarán. ¿Continuar?")) return;
                      bpmn.mutate();
                    }}
                  >
                    Guardar diagrama
                  </Button>
                  <Button
                    disabled={!saveXml || convert.isPending}
                    onClick={() => convert.mutate()}
                  >
                    {convert.isPending
                      ? "Analizando…"
                      : "Convertir en etapas editables"}
                  </Button>
                </div>
              )}
            </div>
            <div className="h-[65vh] min-h-96 overflow-hidden rounded-lg border border-border">
              <BpmnStudio
                key={`${d.id}-${d.version}`}
                xml={d.bpmnXml}
                visible={tab === "diagrama"}
                onReady={(fn) => setSaveXml(fn ? () => fn : null)}
                onDirtyChange={setXmlDirty}
              />
            </div>
          </div>
        )}
        {tab === "seguimiento" && <RunMonitor definition={d} />}
        {tab === "decisiones" && d.dmnXml && (
          <>
            <p className="mb-5 max-w-2xl text-sm text-muted-foreground">
              Tabla de decisiones asociada a este proceso. Las reglas de
              asignación ejecutables se configuran en Etapas y responsables →
              Datos, condiciones y asignación automática.
            </p>
            <DmnStudio xml={d.dmnXml} />
          </>
        )}
      </section>
      <VersionHistory
        open={history}
        onOpenChange={setHistory}
        definition={d}
        admin={admin}
        onRestored={onRefresh}
      />
      <ConfirmDialog
        open={archive}
        onOpenChange={setArchive}
        title="¿Eliminar este proceso del catálogo?"
        description="Se retirará del catálogo. Las solicitudes, versiones y evidencia se conservan. Los formatos ya asociados conservan su configuración: revisa dónde se usa el proceso si también quieres retirarlos."
        confirmLabel="Eliminar del catálogo"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
