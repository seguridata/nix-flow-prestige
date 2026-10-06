"use client";

import { AppShell } from "@/components/layout/app-shell";
import { FormatEditor } from "@/components/formats/format-editor";
import { useSession } from "@/store/session-store";

export default function NuevoFormatoPage() {
  const { roles } = useSession();
  return (
    <AppShell title="Nuevo formato">
      {roles.includes("admin") ? (
        <FormatEditor />
      ) : (
        <p className="max-w-md text-sm text-muted-foreground">Solo el administrador puede crear formatos.</p>
      )}
    </AppShell>
  );
}
