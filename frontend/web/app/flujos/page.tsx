"use client";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, GitBranch, PencilLine, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/store/session-store";
import { fetchFlowDefinitions, type FlowDefinition } from "@/services/formats-service";

function FlowLibrary() {
  const { roles, tenantId } = useSession();
  const selected = useSearchParams().get("process");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const admin = roles.includes("admin");
  const defs = useQuery({ queryKey: ["flows"], queryFn: () => fetchFlowDefinitions(), enabled: admin });
  const rows = useMemo(() => {
    const groups = new Map<string, FlowDefinition[]>();
    for (const d of defs.data ?? []) if (d.flow) groups.set(d.key, [...(groups.get(d.key) ?? []), d]);
    return [...groups.entries()].map(([key, all]) => {
      const own = all.filter(d => d.tenantId === tenantId);
      const versions = (own.length ? own : all).sort((a, b) => b.version - a.version);
      return { key, latest: versions[0]!, published: versions.find(d => d.published) };
    }).sort((a, b) => a.latest.name.localeCompare(b.latest.name, "es-MX"));
  }, [defs.data, tenantId]);
  const shown = rows.filter(row => (!selected || row.key === selected) && (filter === "all" || (filter === "published" ? !!row.published : !row.published)) && `${row.latest.name} ${row.latest.description ?? ""}`.toLocaleLowerCase("es-MX").includes(query.toLocaleLowerCase("es-MX")));
  const editHref = (key: string) => `/process?process=${encodeURIComponent(key)}&tab=constructor` as never;
  return <AppShell title="Flujos de aprobación">
    <div className="mx-auto w-full min-w-0 max-w-6xl">
      <PageHeader
        title="Flujos de aprobación"
        description="Un proceso describe el trabajo. Su flujo decide quién revisa o firma. Elige uno publicado para conectarlo a un formato y comenzar una solicitud."
        back={selected ? { href: "/flujos", label: "Ver todos los flujos" } : undefined}
        actions={admin ? <Button asChild><Link href={"/process?new=1&tab=constructor" as never}><Plus /> Crear flujo</Link></Button> : undefined}
      />
      {!admin ? <EmptyState icon={<GitBranch />} title="Tu administrador prepara los flujos" description="Para enviar una solicitud elige un formato: su ruta de aprobación ya está configurada." action={<Button asChild><Link href={"/formatos" as never}>Elegir formato <ArrowRight /></Link></Button>} /> : <>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1"><Search aria-hidden className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><Input className="pl-10" value={query} onChange={e => setQuery(e.target.value)} aria-label="Buscar flujo" placeholder="Buscar por nombre o propósito" /></div>
          <div className="w-full sm:w-56"><Select aria-label="Estado del flujo" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todos los estados</option><option value="published">Listos para usar</option><option value="draft">Por publicar</option></Select></div>
        </div>
        {defs.isLoading ? <Skeleton className="h-48 w-full" /> : defs.isError ? <div role="alert" className="rounded-lg border border-border py-8 text-center">No pudimos cargar los flujos. <Button variant="link" onClick={() => defs.refetch()}>Reintentar</Button></div> : shown.length === 0 ? <EmptyState icon={<GitBranch />} title={query || selected ? "No encontramos ese flujo" : "El siguiente paso empieza aquí"} description="Construye los pasos en Procesos, revisa los responsables y publica cuando esté listo." action={<Button asChild><Link href="/process">Abrir Procesos</Link></Button>} /> : <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
          {shown.map(row => {
            const pending = !!row.published && row.latest.version > row.published.version;
            return <li key={row.key} className="flex flex-col gap-4 px-4 py-5 sm:px-5 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <h2 className="break-words text-base font-semibold">{row.latest.name}</h2>
                  {!row.published ? <Badge variant="neutral"><PencilLine className="size-3.5" aria-hidden />Borrador</Badge> : pending ? <Badge variant="warning"><AlertTriangle className="size-3.5" aria-hidden />Publicado, con cambios sin publicar</Badge> : <Badge variant="success"><CheckCircle2 className="size-3.5" aria-hidden />Publicado</Badge>}
                </div>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{row.latest.description || "Define los responsables y el recorrido de aprobación."}</p>
                <p className="mt-2 text-sm text-muted-foreground">{row.latest.flow!.steps.length} pasos · {row.latest.flow!.order === "SECUENCIAL" ? "Uno después de otro" : "En paralelo"} · Plazo {row.latest.flow!.slaHours} h</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {!row.published ? <Button asChild><Link href={editHref(row.key)}>Revisar y publicar</Link></Button>
                  : pending ? <><Button asChild><Link href={editHref(row.key)}>Revisar y publicar</Link></Button><Button asChild variant="outline"><Link href={`/formatos?flow=${encodeURIComponent(row.key)}` as never}>Usar versión publicada</Link></Button></>
                  : <><Button asChild><Link href={`/formatos?flow=${encodeURIComponent(row.key)}` as never}>Usar este flujo <ArrowRight /></Link></Button><Button asChild variant="outline"><Link href={editHref(row.key)}>Editar pasos</Link></Button></>}
              </div>
            </li>;
          })}
        </ul>}
      </>}
    </div>
  </AppShell>;
}
export default function FlujosPage() { return <Suspense fallback={<div className="p-8">Cargando flujos…</div>}><FlowLibrary /></Suspense>; }
