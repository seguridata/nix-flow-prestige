"use client";

import { useState } from "react";
import { FileText, FileUp } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { FormatEditor } from "@/components/formats/format-editor";
import { useSession } from "@/store/session-store";
import type { FormatKind } from "@/services/formats-service";

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

export default function NuevoFormatoPage() {
  const { roles } = useSession();
  const [mode, setMode] = useState<FormatKind | null>(null);
  return (
    <AppShell title="Nuevo formato">
      {!roles.includes("admin") ? (
        <p className="max-w-md text-sm text-muted-foreground">Solo el administrador puede crear formatos.</p>
      ) : mode ? (
        <FormatEditor mode={mode} />
      ) : (
        <section aria-labelledby="nuevo-tipo" className="max-w-2xl">
          <h2 id="nuevo-tipo" className="text-base font-semibold">
            ¿Cómo quieres crear el formato?
          </h2>
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
