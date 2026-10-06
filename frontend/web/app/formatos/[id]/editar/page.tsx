"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";

import { FormatEditor } from "@/components/formats/format-editor";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchFormat } from "@/services/formats-service";
import { useSession } from "@/store/session-store";

export default function EditarFormatoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { roles } = useSession();
  const isAdmin = roles.includes("admin");
  const format = useQuery({ queryKey: ["format", id, "edit"], queryFn: () => fetchFormat(id), enabled: isAdmin, retry: false, staleTime: 0 });

  return (
    <AppShell title={format.data?.name ?? "Editar formato"}>
      {!isAdmin ? (
        <p className="max-w-md text-sm text-muted-foreground">Solo el administrador puede editar formatos.</p>
      ) : format.isLoading ? (
        <Skeleton className="h-96 max-w-2xl rounded-lg" />
      ) : format.isError || !format.data ? (
        <p role="alert" className="text-sm">
          No se encontró el formato.
        </p>
      ) : (
        <FormatEditor key={format.data.id} initial={format.data} />
      )}
    </AppShell>
  );
}
