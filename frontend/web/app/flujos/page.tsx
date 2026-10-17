"use client";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, GitBranch, Pencil, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  return <AppShell title="Flujos de aprobación" actions={admin ? <Button asChild><Link href={"/process?new=1&tab=constructor" as never}><Plus className="size-4" /> Crear flujo</Link></Button> : undefined}>
    <div className="max-w-6xl">
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Un proceso describe el trabajo. Su flujo decide quién revisa o firma. Elige uno publicado para conectarlo a un formato y comenzar una solicitud.</p>
      <ol aria-label="De proceso a solicitud" className="my-6 flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-border py-4 text-sm">
        <li><Link className="underline-offset-4 hover:underline" href="/process">1. Diseña el proceso</Link></li><ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        <li className="font-semibold">2. Publica su flujo</li><ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        <li><Link className="underline-offset-4 hover:underline" href={"/formatos" as never}>3. Usa un formato y envía</Link></li>
      </ol>
      {!admin ? <p className="py-8 text-sm text-muted-foreground">Tu administrador prepara los flujos. Puedes iniciar una solicitud desde <Link href={"/formatos" as never} className="font-medium text-foreground underline">Formatos</Link>.</p> : <>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={e => setQuery(e.target.value)} aria-label="Buscar flujo" placeholder="Buscar por nombre o propósito" /></div>
          <select aria-label="Estado del flujo" value={filter} onChange={e => setFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="all">Todos los estados</option><option value="published">Listos para usar</option><option value="draft">Por publicar</option></select>
          {selected ? <Button asChild variant="ghost"><Link href={"/flujos" as never}>Ver todos</Link></Button> : null}
        </div>
        {defs.isLoading ? <Skeleton className="h-48 w-full" /> : defs.isError ? <div role="alert" className="border-y border-border py-8">No pudimos cargar los flujos. <Button variant="link" onClick={() => defs.refetch()}>Reintentar</Button></div> : shown.length === 0 ? <div className="py-14 text-center"><GitBranch className="mx-auto size-8 text-muted-foreground" /><h2 className="mt-4 text-lg font-semibold">{query || selected ? "No encontramos ese flujo" : "El siguiente paso empieza aquí"}</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Construye los pasos en Procesos, revisa los responsables y publica cuando esté listo.</p><Button asChild className="mt-5"><Link href="/process">Abrir Procesos</Link></Button></div> : <ul className="divide-y divide-border border-y border-border">
          {shown.map(row => <li key={row.key} className="flex flex-col gap-4 py-6 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-semibold">{row.latest.name}</h2><span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">{row.published ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}{row.published ? "Listo para solicitudes" : "Borrador"}</span></div><p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{row.latest.description || "Define los responsables y el recorrido de aprobación."}</p><p className="mt-2 text-xs text-muted-foreground">{row.latest.flow!.steps.length} pasos · {row.latest.flow!.order === "SECUENCIAL" ? "Uno después de otro" : "En paralelo"} · Plazo {row.latest.flow!.slaHours} h{row.published && row.latest.version > row.published.version ? " · Hay cambios sin publicar" : ""}</p></div>
            <div className="flex shrink-0 flex-wrap gap-2"><Button asChild variant="outline"><Link href={`/process?process=${encodeURIComponent(row.key)}&tab=constructor` as never}><Pencil className="size-4" /> Editar pasos</Link></Button>{row.published ? <Button asChild><Link href={`/formatos?flow=${encodeURIComponent(row.key)}` as never}>Usar este flujo <ArrowRight className="size-4" /></Link></Button> : <Button asChild><Link href={`/process?process=${encodeURIComponent(row.key)}&tab=constructor` as never}>Revisar y publicar</Link></Button>}</div>
          </li>)}
        </ul>}
      </>}
    </div>
  </AppShell>;
}
export default function FlujosPage() { return <Suspense fallback={<div className="p-8">Cargando flujos…</div>}><FlowLibrary /></Suspense>; }
