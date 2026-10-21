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
  ClipboardCheck,
  Download,
  FileText,
  History,
  ListChecks,
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
      badge: "Sin pasos todavía",
      variant: "warning" as const,
      Icon: CircleAlert,
      next: "Crear los pasos",
      hint: "Solo tiene un diagrama. Falta definir los pasos.",
    };
  if (d.publishedVersion == null)
    return {
      badge: "Borrador",
      variant: "neutral" as const,
      Icon: PencilLine,
      next: d.flow.steps.length ? "Dejar listo" : "Agregar pasos",
      hint: d.flow.steps.length
        ? "Aún no se usa. Revísalo y déjalo listo."
        : "Aún no tiene pasos.",
    };
  if (d.version > d.publishedVersion)
    return {
      badge: "Tiene cambios sin publicar",
      variant: "warning" as const,
      Icon: AlertTriangle,
      next: "Dejar listo",
      hint: "Se usa la versión anterior hasta que lo dejes listo de nuevo.",
    };
  return {
    badge: "Listo para usar",
    variant: "success" as const,
    Icon: CheckCircle2,
    next: "Usarlo en un formato",
    hint: "Ya puedes usarlo en un formato.",
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
              description="El administrador prepara los procesos. Para enviar una solicitud, elige un formato disponible: su ruta de aprobación ya está lista."
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
              description="Un proceso es la ruta que sigue una solicitud hasta quedar aprobada. Define los pasos, déjalo listo y úsalo en un formato."
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
                  placeholder="Buscar un proceso…"
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
                  <option value="publicados">Listos para usar</option>
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
                    <li
                      key={d.key}
                      className="flex flex-col gap-1 sm:flex-row sm:items-center"
                    >
                      <button
                        type="button"
                        className="group flex min-h-20 w-full min-w-0 flex-1 items-center gap-4 px-4 py-4 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                        onClick={() => setSelectedKey(d.key)}
                      >
                        <div className="min-w-0 flex-1">
                          <h2 className="break-words font-semibold">
                            {d.name}
                          </h2>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                            <Badge variant={status.variant}>
                              <status.Icon className="size-3.5" aria-hidden />
                              {status.badge}
                            </Badge>
                            <span>{status.hint}</span>
                          </p>
                          <p className="mt-1.5 text-sm text-muted-foreground">
                            {d.flow?.steps.length ?? 0}{" "}
                            {(d.flow?.steps.length ?? 0) === 1
                              ? "paso"
                              : "pasos"}
                            {d.description ? ` · ${d.description}` : ""}
                          </p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-2 px-4 pb-4 sm:px-5 sm:pb-0">
                        {d.publishedVersion != null &&
                        d.version <= d.publishedVersion ? (
                          <Button asChild variant="outline" className="sm:w-48 sm:justify-between">
                            <Link
                              href={
                                `/formatos?flow=${encodeURIComponent(d.key)}` as never
                              }
                            >
                              {status.next}
                              <ArrowRight />
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            className="sm:w-48 sm:justify-between"
                            onClick={() => setSelectedKey(d.key)}
                          >
                            {status.next}
                            <ChevronRight />
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              className="size-11 px-0"
                              aria-label={`Más acciones para ${d.name}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => setSelectedKey(d.key)}
                            >
                              <PencilLine /> Abrir y editar pasos
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
                    : "Crea los pasos de aprobación de una solicitud de gastos o de una adquisición."
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
      toast.success("Proceso creado. Ahora define sus pasos.");
      onCreated(d.key);
    },
    onError: failure,
  });
  return (
    <section className="max-w-xl">
      <BackButton onClick={onCancel}>Volver a procesos</BackButton>
      <PageHeader
        title="Crear proceso"
        description="Empieza con un nombre claro. Después agregarás los pasos de aprobación."
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
            {create.isPending ? "Creando…" : "Crear y definir los pasos"}
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

/** Avance real del proceso: icono grande por paso unido por líneas (negra lo recorrido, gris lo que falta), con el estado también en texto. */
function ProcessProgress({
  steps,
}: {
  steps: { id: string; label: string; state: StepState; href?: string; onNavigate?: (e: React.MouseEvent) => void }[];
}) {
  const icons = [ListChecks, ClipboardCheck, FileText];
  const stateText: Record<StepState, string> = {
    done: "Completado",
    current: "Paso actual",
    pending: "Pendiente",
  };
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.state === "current"),
  );
  return (
    <nav aria-label="Preparar el proceso" className="rounded-2xl border border-border bg-muted/50 px-3 py-5 sm:px-8 sm:py-6">
      <ol className="flex">
        {steps.map((step, i) => {
          const Icon = icons[i] ?? ListChecks;
          const reached = step.state !== "pending";
          const body = (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex h-14 items-center justify-center transition-colors",
                  reached ? "text-primary" : "text-muted-foreground/70",
                )}
              >
                <Icon className="size-11 sm:size-12" strokeWidth={1.4} />
              </span>
              <span
                className={cn(
                  "flex items-center justify-center gap-1 text-balance text-center text-sm leading-tight",
                  reached ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {step.state === "done" ? <Check aria-hidden className="size-4 shrink-0" strokeWidth={3} /> : null}
                {step.label}
              </span>
              <span className="sr-only">{`, ${stateText[step.state].toLowerCase()}`}</span>
            </>
          );
          const column = "group mx-auto flex min-h-14 w-full max-w-48 flex-col items-center gap-2.5 rounded-xl px-1 py-1";
          return (
            <li key={step.id} className="relative flex-1" aria-current={step.state === "current" ? "step" : undefined}>
              {step.href ? (
                <Link
                  href={step.href as never}
                  onClick={step.onNavigate}
                  className={cn(column, "outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                >
                  {body}
                </Link>
              ) : (
                <div className={column}>{body}</div>
              )}
              {i < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute left-[calc(50%+2.25rem)] top-6 h-1.5 w-[calc(100%-4.5rem)] -translate-y-1/2 rounded-full sm:left-[calc(50%+2.75rem)] sm:top-7 sm:w-[calc(100%-5.5rem)]",
                    i < currentIndex ? "bg-foreground" : "bg-foreground/25",
                  )}
                />
              ) : null}
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
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const flowDirty =
    JSON.stringify(draft) !== JSON.stringify(d.flow ?? null) || name !== d.name;
  const dirty = flowDirty || xmlDirty;
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
    onSuccess: () => { setXmlDirty(false); saved("Cambios guardados."); },
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
        throw new Error("Resuelve los puntos indicados antes de dejarlo listo.");
      return setFlowPublished(d.key, d.version, true);
    },
    onSuccess: () =>
      saved("Listo para usar. Ya puedes usarlo en un formato."),
    onError: failure,
  });
  const remove = useMutation({
    mutationFn: () => apiClient.delete(path(d.key)),
    onSuccess: () => {
      toast.success("Proceso retirado. Sus solicitudes y su historial se conservan.");
      onArchived();
    },
    onError: failure,
  });
  const bpmn = useMutation({
    mutationFn: async () => {
      if (!saveXml) throw new Error("El diagrama todavía está cargando.");
      return apiClient.put(path(d.key), { bpmnXml: await saveXml() });
    },
    onSuccess: () => { setXmlDirty(false); saved("Diagrama guardado."); },
    onError: failure,
  });
  const convert = useMutation({
    mutationFn: async () => {
      // Si el diagrama no se ha abierto, se usa el guardado: no hace falta montar el modelador.
      const xml = saveXml ? await saveXml() : d.bpmnXml;
      return convertBpmnToFlow(xml, draft?.variables);
    },
    onSuccess: (r) => {
      if (!r.flow) {
        toast.error(r.errors.join(" "));
        return;
      }
      setDraft(r.flow);
      setTab("constructor");
      toast.success(
        "Pasos creados. Revisa quién responde en cada uno y guarda los cambios.",
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
  const tabs: [Tab, string][] = [["constructor", "Pasos"]];
  if (admin) tabs.push(["probar", "Probar antes de usar"]);
  tabs.push(["seguimiento", "En curso"]);
  if (d.dmnXml && !d.dmnXml.includes("Determinar SLA y orden"))
    tabs.push(["decisiones", "Tabla de decisiones"]);
  tabs.push(["diagrama", "Diagrama (solo si lo necesitas)"]);

  const hasSteps = (d.flow?.steps.length ?? 0) > 0;
  const isPublished =
    d.publishedVersion != null && d.version <= d.publishedVersion;
  const current = !hasSteps ? 0 : !isPublished ? 1 : 2;
  const stateOf = (i: number): StepState =>
    i < current ? "done" : i === current ? "current" : "pending";
  const formatsHref = `/formatos?flow=${encodeURIComponent(d.key)}`;
  const nextHelp = [
    draft
      ? "Agrega los pasos por los que irá la solicitud y quién responde en cada uno."
      : "Este proceso solo tiene un diagrama. Crea sus pasos para poder editarlo.",
    dirty
      ? "Guarda tus cambios y después déjalo listo para usar."
      : "Revisamos que todo esté completo y queda disponible para tus formatos.",
    "Ya está listo. Elige en qué formato se va a usar.",
  ][current];
  const saveBlocked =
    save.isPending ||
    !flowDirty ||
    !draft ||
    name.trim().length < 3 ||
    (draft ? flowProblems(draft).length > 0 : false);
  const saveFlow = () => {
    if (
      xmlDirty &&
      !window.confirm(
        "Al guardar los pasos se vuelve a dibujar el diagrama y se pierden sus cambios sin guardar. ¿Continuar?",
      )
    )
      return;
    save.mutate();
  };
  /** Un solo botón con relleno: la acción que toca ahora. */
  const primary = !admin ? null : current === 2 ? (
    <Button asChild>
      <Link href={formatsHref as never} onClick={confirmLeaveToFormats}>
        Usarlo en un formato <ArrowRight />
      </Link>
    </Button>
  ) : flowDirty ? (
    <Button disabled={saveBlocked} onClick={saveFlow}>
      {save.isPending ? "Guardando…" : "Guardar cambios"}
    </Button>
  ) : xmlDirty ? (
    <Button
      disabled={!saveXml || bpmn.isPending}
      onClick={() => bpmn.mutate()}
    >
      {bpmn.isPending ? "Guardando…" : "Guardar el diagrama"}
    </Button>
  ) : current === 1 ? (
    <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
      {publish.isPending ? "Revisando…" : "Dejar listo para usar"}
    </Button>
  ) : null;

  return (
    <>
      <BackButton onClick={back}>Todos los procesos</BackButton>
      <PageHeader
        className="mb-6"
        title={<span className="break-words">{d.name}</span>}
        description={
          d.description || "Aquí defines el camino que sigue cada solicitud."
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Badge variant={dirty ? "warning" : "neutral"}>
              {dirty ? (
                <AlertTriangle className="size-3.5" aria-hidden />
              ) : (
                <Check className="size-3.5" aria-hidden />
              )}
              {dirty ? "Cambios sin guardar" : "Todo guardado"}
            </Badge>
            <span>
              {d.publishedVersion
                ? `Se está usando la versión ${d.publishedVersion}`
                : "Todavía no se usa"}
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setHistory(true)}>
              <History /> Historial de cambios
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
                    <Download /> Descargar una copia del proceso
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setArchive(true)}>
                    <Trash2 /> Eliminar proceso
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      <ProcessProgress
        steps={[
          { id: "disenar", label: "Define los pasos", state: stateOf(0) },
          { id: "publicar", label: "Revisa y deja listo", state: stateOf(1) },
          {
            id: "usar",
            label: "Úsalo en un formato",
            state: stateOf(2),
            href: isPublished ? formatsHref : undefined,
            onNavigate: confirmLeaveToFormats,
          },
        ]}
      />
      <div
        className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-secondary px-4 py-3.5 text-secondary-foreground"
        data-tour="process-next"
      >
        <p className="min-w-0 flex-1 basis-64 text-sm text-white/80">
          <span className="font-semibold text-white">Qué sigue: </span>
          {nextHelp}
        </p>
        {primary}
      </div>
      <div
        role="tablist"
        aria-label="Vistas del proceso"
        className="mt-6 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:thin]"
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
              "min-h-11 shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              tab === id
                ? "bg-background font-semibold text-foreground shadow-subtle"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
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
                    <Button
                      variant="outline"
                      disabled={validate.isPending}
                      onClick={() => validate.mutate()}
                    >
                      {validate.isPending
                        ? "Revisando…"
                        : "Revisar que todo esté bien"}
                    </Button>
                  )}
                </div>
                <VerticalBuilder
                  value={draft}
                  onChange={(flow) => {
                    setDraft(flow);
                    setPreflight(null);
                  }}
                  readOnly={!admin}
                  onTest={admin ? () => setTab("probar") : undefined}
                />
              </>
            ) : (
              <EmptyState
                icon={<Workflow />}
                title="Este proceso solo tiene un diagrama"
                description="Todavía no tiene pasos que puedas editar. Podemos crearlos a partir del diagrama y después cambias quién responde en cada uno."
                action={
                  admin ? (
                    <Button
                      disabled={convert.isPending}
                      onClick={() => convert.mutate()}
                    >
                      {convert.isPending
                        ? "Creando los pasos…"
                        : "Crear los pasos a partir del diagrama"}
                    </Button>
                  ) : undefined
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
                    ? "Todo en orden: ya puedes dejarlo listo para usar"
                    : "Revisa estos puntos antes de dejarlo listo"}
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
              title="Primero crea los pasos"
              description="Para probar cómo se aprobaría una solicitud, el proceso necesita sus pasos."
              action={
                <Button
                  variant="outline"
                  disabled={convert.isPending}
                  onClick={() => convert.mutate()}
                >
                  {convert.isPending
                    ? "Creando los pasos…"
                    : "Crear los pasos a partir del diagrama"}
                </Button>
              }
            />
          ))}
        {tab === "diagrama" && (
          <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
            No hace falta para armar un proceso: los pasos de la primera
            pestaña son suficientes. El diagrama es una vista técnica para
            quien ya sabe modelar procesos.
          </p>
        )}
        {(tab === "diagrama" || diagramOpen) && (
          <div hidden={tab !== "diagrama"}>
            <details
              className="rounded-lg border border-border bg-background"
              open={diagramOpen}
              onToggle={(e) => setDiagramOpen(e.currentTarget.open)}
            >
              <summary className="flex min-h-11 cursor-pointer items-center px-4 py-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {diagramOpen ? "Ocultar el diagrama" : "Mostrar el diagrama"}
              </summary>
              <div className="border-t border-border p-4">
                <p
                  role="note"
                  className="mb-4 flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
                >
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden
                  />
                  Cuidado: mover o borrar elementos aquí no cambia quién
                  aprueba. Para eso usa la pestaña «Pasos».
                </p>
                {xmlDirty && (
                  <p role="status" className="mb-3 text-sm font-medium">
                    Diagrama con cambios sin guardar. Se conservan al cambiar
                    de pestaña.
                  </p>
                )}
                {admin && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={!saveXml || bpmn.isPending}
                      onClick={() => {
                        if (
                          flowDirty &&
                          !window.confirm(
                            "Guardar el diagrama creará una versión sin pasos editables. Los pasos sin guardar se reemplazarán. ¿Continuar?",
                          )
                        )
                          return;
                        bpmn.mutate();
                      }}
                    >
                      Guardar diagrama
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!saveXml || convert.isPending}
                      onClick={() => convert.mutate()}
                    >
                      {convert.isPending
                        ? "Creando los pasos…"
                        : "Crear los pasos a partir de este diagrama"}
                    </Button>
                  </div>
                )}
                {diagramOpen && (
                  <div className="h-[70vh] min-h-[480px] overflow-hidden rounded-lg border border-border">
                    <BpmnStudio
                      key={`${d.id}-${d.version}`}
                      xml={d.bpmnXml}
                      visible={tab === "diagrama"}
                      onReady={(fn) => setSaveXml(fn ? () => fn : null)}
                      onDirtyChange={setXmlDirty}
                    />
                  </div>
                )}
              </div>
            </details>
          </div>
        )}
        {tab === "seguimiento" && <RunMonitor definition={d} />}
        {tab === "decisiones" && d.dmnXml && (
          <>
            <p className="mb-5 max-w-2xl text-sm text-muted-foreground">
              Tabla de decisiones asociada a este proceso. Las reglas que sí se
              aplican se configuran en Pasos → Datos y reglas (avanzado).
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
        title="¿Eliminar este proceso?"
        description="Se retirará de la lista. Las solicitudes y el historial se conservan. Los formatos que ya lo usan siguen funcionando: revisa dónde se usa si también quieres retirarlos."
        confirmLabel="Eliminar proceso"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
