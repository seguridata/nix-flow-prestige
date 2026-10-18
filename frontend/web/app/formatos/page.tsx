"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FilePlus2, FileText, Pencil, Search } from "lucide-react";

import { TemplateDrafts } from "@/components/chat/template-drafts";
import { DocumentIcon } from "@/components/drive/drive-icons";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
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

  return (
    <AppShell
      title="Formatos"
      actions={
        isAdmin ? (
          <Button asChild size="sm">
            <Link href={(flowKey ? `/formatos/nuevo?flow=${encodeURIComponent(flowKey)}` : "/formatos/nuevo") as never}>
              <FilePlus2 /> Nuevo formato
            </Link>
          </Button>
        ) : undefined
      }
    >
      <p className="mb-5 max-w-xl text-sm text-muted-foreground">
        Elige un formato, llena tus datos y se envía a quien corresponda. El documento se completa solo y el flujo de firmas ya viene definido.
      </p>
      {flowKey ? <section className="mb-6 flex flex-wrap items-center justify-between gap-3 border-y border-border py-4" aria-label="Continuar con el flujo"><div><h2 className="font-semibold">Elige el formato que usará este flujo</h2><p className="mt-1 text-sm text-muted-foreground">Abre uno publicado para llenar los datos y enviar. Si aún no hay uno, crea su hoja digital.</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link href={"/formatos" as never}>Todos los formatos</Link></Button>{isAdmin ? <Button asChild><Link href={`/formatos/nuevo?flow=${encodeURIComponent(flowKey)}` as never}>Crear formato con este flujo</Link></Button> : null}</div></section> : null}

      {isAdmin ? <TemplateDrafts /> : null}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 w-64 pl-9" aria-label="Buscar formato" placeholder="Buscar formato" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                  "rounded-full border px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  category === c ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted",
                )}
              >
                {c ?? "Todos"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {formats.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
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
        <div className="flex flex-col items-center py-16 text-center">
          <DocumentIcon className="size-16" />
          <p className="mt-4 text-base font-medium">{loaded.length ? (formats.hasNextPage ? "No hay coincidencias entre los formatos cargados" : "Ningún formato coincide") : "Aún no hay formatos publicados"}</p>
          {isAdmin && !loaded.length ? (
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Sube un PDF y marca dónde van los datos, o crea un formato digital sin PDF. Define el flujo y los anexos. Por ejemplo, un formato de vacaciones.</p>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((f) => (
            <FormatCard key={f.id} format={f} isAdmin={isAdmin} />
          ))}
        </ul>
      )}
      {!formats.isLoading && loaded.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
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

function FormatCard({ format: f, isAdmin }: { format: FormatSummary; isAdmin: boolean }) {
  return (
    <li className="relative">
      <Link
        href={`/formatos/${f.id}` as never}
        className="flex h-full gap-4 rounded-lg border border-border p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DocumentIcon label={kindIconLabel(f.kind)} className="size-14 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium leading-snug">{f.name}</span>
          {f.description ? <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{f.description}</span> : null}
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {f.category ? <span className="rounded-full border border-border px-2 py-0.5">{f.category}</span> : null}
            <span>{plural(f.fieldCount, "dato", "datos")}</span>
            <span>{plural(f.stepCount, "paso", "pasos")}</span>
            {f.kind === "FORM" ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                <FileText className="size-3.5" aria-hidden /> {kindLabel(f.kind)}
              </span>
            ) : null}
            {!f.published ? <span className="rounded-full border border-foreground px-2 py-0.5 font-medium text-foreground">Borrador</span> : null}
          </span>
        </span>
      </Link>
      {isAdmin ? (
        <Link
          href={`/formatos/${f.id}/editar` as never}
          aria-label={`Editar ${f.name}`}
          className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="size-4" />
        </Link>
      ) : null}
    </li>
  );
}
