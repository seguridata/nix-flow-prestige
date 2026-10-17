"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileText, FileUp } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { FormatEditor } from "@/components/formats/format-editor";
import { useSession } from "@/store/session-store";
import { fetchFlowDefinitions, type FormatKind } from "@/services/formats-service";
import { Button } from "@/components/ui/button";

const CHOICES: { kind: FormatKind; title: string; text: string; icon: typeof FileUp }[] = [
  {
    kind: "PDF",
    title: "Subir un PDF",
    text: "Ya tienes el documento. Subes el PDF y marcas dónde va cada dato.",
    icon: FileUp,
  },
  {
    kind: "FORM",
    title: "Formato digital",
    text: "Sin PDF. Defines los datos, el flujo y los anexos, y el sistema genera la hoja base.",
    icon: FileText,
  },
];

function NuevoFormatoContent() {
  const { roles, tenantId } = useSession();
  const flowKey = useSearchParams().get("flow");
  const selectedFlow = useQuery({ queryKey: ["flows", "published"], queryFn: () => fetchFlowDefinitions(true), enabled: !!flowKey && roles.includes("admin") });
  const candidates = (selectedFlow.data ?? []).filter(d => d.key === flowKey && d.flow);
  const seed = candidates.filter(d => d.tenantId === tenantId).sort((a, b) => b.version - a.version)[0] ?? candidates.sort((a, b) => b.version - a.version)[0];
  const [mode, setMode] = useState<FormatKind | null>(null);
  return (
    <AppShell title="Nuevo formato">
      {!roles.includes("admin") ? (
        <p className="max-w-md text-sm text-muted-foreground">Solo el administrador puede crear formatos.</p>
      ) : flowKey && selectedFlow.isLoading ? <p role="status">Preparando el flujo publicado…</p>
      : flowKey && !seed ? <div role="alert" className="max-w-xl space-y-4"><p>Este flujo no está publicado o ya no está disponible. Revísalo antes de conectarlo a un formato.</p><Button asChild variant="outline"><Link href={`/process?process=${encodeURIComponent(flowKey)}` as never}>Revisar proceso</Link></Button></div>
      : mode ? (
        <FormatEditor mode={mode} proposal={seed?.flow ? { name: seed.name, description: seed.description, flow: seed.flow, flowKey: seed.key, flowVersion: seed.version } : undefined} />
      ) : (
        <section aria-labelledby="nuevo-tipo" className="max-w-2xl">
          <h2 id="nuevo-tipo" className="text-base font-semibold">
            ¿Cómo quieres crear el formato?
          </h2>
          {seed ? <p className="mt-2 text-sm text-muted-foreground">Usarás «{seed.name}» con sus {seed.flow!.steps.length} pasos de aprobación. El formato permanecerá como borrador hasta que lo revises.</p> : null}
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {CHOICES.map((c) => (
              <li key={c.kind}>
                <button
                  type="button"
                  onClick={() => setMode(c.kind)}
                  className="flex h-full w-full flex-col items-start gap-2 rounded-lg border border-border p-4 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <c.icon className="size-6" aria-hidden />
                  <span className="text-base font-medium">{c.title}</span>
                  <span className="text-sm text-muted-foreground">{c.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
export default function NuevoFormatoPage() { return <Suspense fallback={<div className="p-8">Preparando formato…</div>}><NuevoFormatoContent /></Suspense>; }
