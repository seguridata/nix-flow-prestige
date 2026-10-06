"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FilePlus2, Pencil, Search } from "lucide-react";

import { DocumentIcon } from "@/components/drive/drive-icons";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { plural } from "@/libs/drive";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";
import { fetchFormats, type FormatSummary } from "@/services/formats-service";

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function FormatosPage() {
  const { roles } = useSession();
  const isAdmin = roles.includes("admin");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const formats = useQuery({ queryKey: ["formats", isAdmin], queryFn: () => fetchFormats(isAdmin) });

  const categories = useMemo(
    () => [...new Set((formats.data ?? []).map((f) => f.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "es-MX")),
    [formats.data],
  );
  const shown = useMemo(
    () =>
      (formats.data ?? []).filter(
        (f) => (!category || f.category === category) && (!query.trim() || norm(`${f.name} ${f.description ?? ""}`).includes(norm(query.trim()))),
      ),
    [formats.data, category, query],
  );

  return (
    <AppShell
      title="Formatos"
      actions={
        isAdmin ? (
          <Button asChild size="sm">
            <Link href={"/formatos/nuevo" as never}>
              <FilePlus2 /> Nuevo formato
            </Link>
          </Button>
        ) : undefined
      }
    >
      <p className="mb-5 max-w-xl text-sm text-muted-foreground">
        Elige un formato, llena tus datos y se envía a quien corresponda. El documento se completa solo y el flujo de firmas ya viene definido.
      </p>

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
      ) : formats.isError ? (
        <div role="alert" className="rounded-lg border border-border p-5 text-sm">
          No se pudieron cargar los formatos.{" "}
          <Button variant="link" onClick={() => formats.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <DocumentIcon className="size-16" />
          <p className="mt-4 text-base font-medium">{formats.data?.length ? "Ningún formato coincide" : "Aún no hay formatos publicados"}</p>
          {isAdmin && !formats.data?.length ? (
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Sube un PDF, marca dónde van los datos y define el flujo. Por ejemplo, un formato de vacaciones.</p>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((f) => (
            <FormatCard key={f.id} format={f} isAdmin={isAdmin} />
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function FormatCard({ format: f, isAdmin }: { format: FormatSummary; isAdmin: boolean }) {
  return (
    <li className="relative">
      <Link
        href={`/formatos/${f.id}` as never}
        className="flex h-full gap-4 rounded-lg border border-border p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DocumentIcon className="size-14 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium leading-snug">{f.name}</span>
          {f.description ? <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{f.description}</span> : null}
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {f.category ? <span className="rounded-full border border-border px-2 py-0.5">{f.category}</span> : null}
            <span>{plural(f.fieldCount, "dato", "datos")}</span>
            <span>{plural(f.stepCount, "paso", "pasos")}</span>
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
