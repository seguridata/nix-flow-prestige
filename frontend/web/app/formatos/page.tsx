"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowRight, Check, CircleDashed, FilePlus2, FileText, Pencil, Search } from "lucide-react";

import { TemplateDrafts } from "@/components/chat/template-drafts";
import { DocumentIcon } from "@/components/drive/drive-icons";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { plural } from "@/libs/drive";
import { kindIconLabel, kindLabel } from "@/libs/format-steps";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";
import { fetchFormatsPage, type FormatSummary } from "@/services/formats-service";

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function FormatosContent() {
  const { tenantId, signerId } = useSession();
  return <FormatosCatalog key={`${tenantId}:${signerId}`} />;
}

function FormatosCatalog() {
  const { roles, tenantId, signerId } = useSession();
  const isAdmin = roles.includes("admin");
  const flowKey = useSearchParams().get("flow");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const formats = useInfiniteQuery({
    queryKey: ["formats", tenantId, signerId, isAdmin, query, category, flowKey],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchFormatsPage(isAdmin, pageParam),
    getNextPageParam: (last, _pages, previous) => last.nextCursor && last.nextCursor !== previous ? last.nextCursor : undefined,
    // Cambiar filtros comienza de nuevo; no se recupera una cadena antigua de
    // páginas al volver a un filtro ya utilizado.
    gcTime: 0,
  });
  const loaded = useMemo(() => [...new Map((formats.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item])).values()], [formats.data]);

  const categories = useMemo(
    () => [...new Set([...loaded.map((f) => f.category), category].filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "es-MX")),
    [loaded, category],
  );
  const shown = useMemo(
    () =>
      loaded.filter(
        (f) => (!flowKey || f.flowKey === flowKey) && (!category || f.category === category) && (!query.trim() || norm(`${f.name} ${f.description ?? ""}`).includes(norm(query.trim()))),
      ),
    [loaded, category, query, flowKey],
  );

  const drafts = isAdmin ? shown.filter((f) => !f.published) : [];
  const published = isAdmin ? shown.filter((f) => f.published) : shown;

  return (
    <AppShell title="Formatos">
      <PageHeader
        title="Formatos"
        description="Elige un formato, llena tus datos y se envía a quien corresponda."
        actions={
          isAdmin ? (
            <Button asChild>
              <Link href={(flowKey ? `/formatos/nuevo?flow=${encodeURIComponent(flowKey)}` : "/formatos/nuevo") as never}>
                <FilePlus2 /> Nuevo formato
              </Link>
            </Button>
          ) : undefined
        }
      />
      {flowKey ? (
        <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-4" aria-label="Continuar con el flujo">
          <div>
            <h2 className="font-semibold">Elige el formato que usará este flujo</h2>
            <p className="mt-1 text-sm text-muted-foreground">Abre uno publicado para llenar los datos y enviar. Si aún no hay uno, crea su hoja digital.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={"/formatos" as never}>Todos los formatos</Link>
            </Button>
            {isAdmin ? (
              <Button asChild>
                <Link href={`/formatos/nuevo?flow=${encodeURIComponent(flowKey)}` as never}>Crear formato con este flujo</Link>
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {isAdmin ? <TemplateDrafts /> : null}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" aria-label="Buscar formato" placeholder="Buscar formato" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {categories.length > 0 ? (
          <div role="group" aria-label="Categorías" className="flex flex-wrap gap-1.5">
            {[null, ...categories].map((c) => (
              <button
                key={c ?? "todas"}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  category === c ? "border-foreground bg-foreground font-medium text-background" : "border-border hover:bg-muted",
                )}
              >
                {category === c ? <Check className="size-3.5" aria-hidden /> : null}
                {c ?? "Todos"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {formats.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : formats.isError && loaded.length === 0 ? (
        <div role="alert" className="rounded-lg border border-border p-5 text-sm">
          No se pudieron cargar los formatos.{" "}
          <Button variant="link" onClick={() => formats.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={loaded.length ? (formats.hasNextPage ? "No hay coincidencias entre los formatos cargados" : "Ningún formato coincide") : "Aún no hay formatos publicados"}
          description={
            loaded.length
              ? "Prueba con otra palabra o quita la categoría elegida."
              : isAdmin
                ? "Sube un PDF y marca dónde van los datos, o crea un formato digital sin PDF. Define la ruta de firmas y los adjuntos. Por ejemplo, un formato de vacaciones."
                : "Cuando el administrador publique un formato, lo verás aquí para llenarlo."
          }
          action={
            isAdmin && !loaded.length ? (
              <Button asChild>
                <Link href={"/formatos/nuevo" as never}>
                  <FilePlus2 /> Nuevo formato
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-10">
          {isAdmin && drafts.length > 0 ? (
            <FormatGroup title="Borradores" note="Aún no los ve nadie más. Termínalos y publícalos desde Editar." formats={drafts} isAdmin={isAdmin} />
          ) : null}
          {published.length > 0 ? (
            <FormatGroup title={isAdmin ? "Publicados" : undefined} note={isAdmin ? "Disponibles para toda la organización." : undefined} formats={published} isAdmin={isAdmin} />
          ) : null}
        </div>
      )}
      {!formats.isLoading && loaded.length > 0 ? (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {plural(shown.length, "formato visible", "formatos visibles")} entre {loaded.length} cargados.
            {formats.hasNextPage ? " Hay más formatos por cargar; los filtros se aplican a los cargados." : " Has llegado al final del catálogo."}
          </p>
          {formats.hasNextPage ? (
            <Button variant="outline" disabled={formats.isFetchingNextPage} onClick={() => formats.fetchNextPage()} aria-label="Cargar más formatos">
              {formats.isFetchingNextPage ? "Cargando más…" : "Cargar más formatos"}
            </Button>
          ) : null}
          {formats.isFetchNextPageError ? <p role="alert" className="w-full text-sm">No se pudo cargar la siguiente página. Conservamos los formatos cargados; vuelve a pulsar Cargar más formatos para reintentar.</p> : null}
        </div>
      ) : null}
    </AppShell>
  );
}

export default function FormatosPage() { return <Suspense fallback={<div className="p-8">Cargando formatos…</div>}><FormatosContent /></Suspense>; }

function FormatGroup({ title, note, formats, isAdmin }: { title?: string; note?: string; formats: FormatSummary[]; isAdmin: boolean }) {
  return (
    <section aria-label={title}>
      {title ? (
        <div className="mb-3">
          <h2 className="text-lg font-semibold">
            {title} <span className="font-normal tabular-nums text-muted-foreground">· {formats.length}</span>
          </h2>
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        </div>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {formats.map((f) => (
          <FormatCard key={f.id} format={f} isAdmin={isAdmin} />
        ))}
      </ul>
    </section>
  );
}

function FormatCard({ format: f, isAdmin }: { format: FormatSummary; isAdmin: boolean }) {
  return (
    <li className="relative">
      <Link
        href={`/formatos/${f.id}` as never}
        className={cn(
          "group flex h-full flex-col gap-3 rounded-lg border bg-background p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
          f.published ? "border-border" : "border-dashed border-foreground/40",
        )}
      >
        <span className="flex gap-3">
          <DocumentIcon label={kindIconLabel(f.kind)} className="size-12 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-medium leading-snug">{f.name}</span>
            <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{f.description || "Sin descripción."}</span>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {!f.published ? (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <CircleDashed className="size-3.5" aria-hidden /> Borrador
            </span>
          ) : null}
          {f.category ? <span>{f.category}</span> : null}
          <span>{kindLabel(f.kind)}</span>
          <span className="tabular-nums">{plural(f.fieldCount, "dato", "datos")}</span>
          <span className="tabular-nums">{plural(f.stepCount, "paso de firma", "pasos de firma")}</span>
        </span>
        <span className="mt-auto flex items-center justify-between pt-1">
          <span className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-[filter] group-hover:brightness-95">
            {f.published ? "Llenar" : "Abrir"} <ArrowRight className="size-4" aria-hidden />
          </span>
        </span>
      </Link>
      {isAdmin ? (
        <Link
          href={`/formatos/${f.id}/editar` as never}
          aria-label={`Editar ${f.name}`}
          className="absolute bottom-4 right-4 inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="size-4" aria-hidden /> Editar
        </Link>
      ) : null}
    </li>
  );
}
