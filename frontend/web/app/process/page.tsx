"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  History,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { BpmnStudio } from "@/components/process-studio/bpmn-studio";
import { DmnStudio } from "@/components/bpm/dmn-studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <main className="mx-auto w-full max-w-6xl selection:bg-primary/25">
      {!admin ? <section className="max-w-xl py-6"><h1 className="text-2xl font-semibold">Solicitudes y aprobaciones</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">El administrador prepara los procesos y publica sus flujos. Para enviar una solicitud, elige un formato disponible: su ruta de aprobación ya está configurada.</p><Button asChild className="mt-5"><Link href="/formatos">Elegir formato<ArrowRight/></Link></Button></section> : creating ? (
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
            <header className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">
                  Del gasto a la aprobación
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  Diseña el proceso, publica su flujo y úsalo en una solicitud.
                  Cada proceso aparece una sola vez; su historial vive dentro.
                </p>
              </div>
              {admin && (
                <div className="flex flex-wrap gap-2">
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
                  <Button
                    variant="outline"
                    disabled={importPackage.isPending}
                    onClick={() => file.current?.click()}
                  >
                    <Upload /> Importar
                  </Button>
                  <Button onClick={() => setCreating(true)}>
                    <Plus /> Crear proceso
                  </Button>
                </div>
              )}
            </header>
            <nav
              aria-label="Cómo funciona"
              className="my-8 grid gap-3 border-y border-border py-5 sm:grid-cols-3"
            >
              {[
                [
                  "Diseña el proceso",
                  "Ordena las revisiones y sus responsables.",
                ],
                ["Publica el flujo", "Comprueba reglas y prepara su uso."],
                [
                  "Crea una solicitud",
                  "Un formato publicado aplica ese flujo.",
                ],
              ].map(([label, help], i) => (
                <div key={label} className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{help}</p>
                  </div>
                </div>
              ))}
            </nav>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <label className="relative min-w-52 flex-1">
                <Search
                  className="absolute left-3 top-3 size-4 text-muted-foreground"
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
              <select
                aria-label="Filtrar procesos"
                className="h-11 rounded-md border border-border bg-background px-3 text-sm"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="todos">Todos</option>
                <option value="publicados">Con flujo publicado</option>
                <option value="borradores">Sin publicar</option>
              </select>
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
              <ul className="divide-y divide-border border-y border-border">
                {visible.map((d) => (
                  <li key={d.key}>
                    <button
                      className="group flex w-full items-center gap-4 px-2 py-5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-primary sm:px-4"
                      onClick={() => setSelectedKey(d.key)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="font-semibold">{d.name}</h2>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs",
                              d.publishedVersion != null
                                ? "bg-primary/15 text-foreground"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {d.publishedVersion != null
                              ? "Disponible para solicitudes"
                              : "Borrador"}
                          </span>
                        </div>
                        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                          {d.description ||
                            "Define las etapas, responsables y condiciones de este proceso."}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {d.flow?.steps.length ?? 0} etapas · {d.versionCount}{" "}
                          {d.versionCount === 1 ? "versión" : "versiones"}
                          {d.publishedVersion != null
                            ? ` · publicada v${d.publishedVersion}`
                            : ""}
                        </p>
                      </div>
                      <ChevronRight
                        className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1"
                        aria-hidden
                      />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-14 text-center">
                <h2 className="font-medium">
                  {rows.length
                    ? "No hay coincidencias"
                    : "El siguiente proceso empieza aquí"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {rows.length
                    ? "Prueba otro nombre o cambia el filtro."
                    : "Crea las etapas de una solicitud de gastos o un subproceso de adquisición."}
                </p>
              </div>
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
      <Button variant="ghost" onClick={onCancel}>
        <ArrowLeft /> Volver a procesos
      </Button>
      <h1 className="mt-5 text-2xl font-semibold">Crear proceso</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Empieza con un nombre claro. Después definirás los datos y las
        aprobaciones.
      </p>
      <form
        className="mt-7 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label className="block text-sm font-medium">
          Nombre
          <Input
            autoFocus
            required
            minLength={3}
            maxLength={120}
            className="mt-2"
            placeholder="Ej. Solicitud de gastos de viaje"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          ¿Para qué se usa?
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border border-border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="flex gap-3">
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
  const tabs: [Tab, string][] = [
    ["constructor", "Etapas y responsables"],
    ["probar", "Probar recorrido"],
    ["diagrama", "Diagrama avanzado"],
    ["seguimiento", "Solicitudes en ejecución"],
  ];
  if (!admin) tabs.splice(1, 1);
  if (d.dmnXml && !d.dmnXml.includes("Determinar SLA y orden"))
    tabs.push(["decisiones", "Tabla de decisiones"]);
  return (
    <>
      <Button variant="ghost" className="-ml-3" onClick={back}>
        <ArrowLeft /> Todos los procesos
      </Button>
      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">
            {d.name}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {d.description || "Configura la ruta que seguirá cada solicitud."}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Editando v{d.version}
            {dirty ? " · cambios sin guardar" : " · guardada"}
            {d.publishedVersion
              ? ` · en uso: v${d.publishedVersion}`
              : " · aún sin publicar"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setHistory(true)}>
            <History /> Historial
          </Button>
          {admin && (
            <>
              <Button
                variant="ghost"
                disabled={exportPackage.isPending}
                onClick={() => exportPackage.mutate()}
                aria-label="Exportar paquete verificable"
              >
                <Download />
              </Button>
              <Button
                variant="ghost"
                aria-label="Eliminar proceso del catálogo"
                onClick={() => setArchive(true)}
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </header>
      <nav
        aria-label="Preparar el proceso"
        className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-border py-4 text-sm"
      >
        <span className="font-medium">1. Diseñar etapas</span>
        <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        <span
          className={
            d.publishedVersion ? "font-medium" : "text-muted-foreground"
          }
        >
          2. Publicar flujo
        </span>
        <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        <Link
          className="underline underline-offset-4 hover:text-primary"
          href={`/formatos?flow=${encodeURIComponent(d.key)}`}
          onClick={(e) => {
            if (
              dirty &&
              !window.confirm("Tienes cambios sin guardar. ¿Ir a formatos?")
            )
              e.preventDefault();
          }}
        >
          3. Asociar a un formato y usar
        </Link>
      </nav>
      <div
        role="tablist"
        aria-label="Vistas del proceso"
        className="mt-4 flex overflow-x-auto border-b border-border"
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
              "shrink-0 border-b-2 px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-primary",
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
        className="py-7"
      >
        {tab === "constructor" && (
          <>
            {draft ? (
              <>
                <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
                  <label className="w-full max-w-lg text-sm font-medium">
                    Nombre del proceso
                    <Input
                      className="mt-2"
                      disabled={!admin}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setPreflight(null);
                      }}
                    />
                  </label>
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
              <div className="max-w-xl py-8">
                <h2 className="text-lg font-semibold">
                  Este proceso todavía tiene solo un diagrama
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Abre el diagrama y extrae sus etapas para convertirlo en un
                  flujo ejecutable. Si contiene elementos incompatibles, te
                  indicaremos cuáles debes ajustar.
                </p>
                <Button
                  className="mt-5"
                  variant="outline"
                  onClick={() => setTab("diagrama")}
                >
                  Abrir diagrama y preparar flujo
                  <ArrowRight />
                </Button>
              </div>
            )}
            {preflight && (
              <div
                className="mt-8 rounded-xl border border-border p-5"
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
                        {check.status === "pass" && (
                          <CheckCircle2 className="size-4" />
                        )}
                        {check.label}
                        <span className="ml-auto text-xs text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
              Primero convierte el diagrama en etapas editables.
            </p>
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
            <div className="h-[65vh] min-h-96 overflow-hidden rounded-xl border border-border">
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
