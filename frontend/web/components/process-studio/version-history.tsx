"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { describeWho, describeWhen } from "@/libs/flow";
import { apiClient } from "@/services/api-client";
import { versionChanges, type ProcessDefinition } from "./model";
const path = (key: string) => `/process-definitions/${encodeURIComponent(key)}`;
const failure = (error: unknown) =>
  toast.error(
    error instanceof Error ? error.message : "No se pudo recuperar la versión.",
  );

export function VersionHistory({
  open,
  onOpenChange,
  definition,
  admin,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: ProcessDefinition;
  admin: boolean;
  onRestored: () => void;
}) {
  const [compare, setCompare] = useState<number | null>(null);
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const versions = useQuery({
    queryKey: ["process-versions", definition.key, definition.version],
    queryFn: () =>
      apiClient.get<ProcessDefinition[]>(`${path(definition.key)}/versions`),
    enabled: open,
  });
  const older = versions.data?.find((v) => v.version === compare);
  const restore = useMutation({
    mutationFn: (version: number) =>
      apiClient.post(`${path(definition.key)}/versions/${version}/restore`, {}),
    onSuccess: () => {
      toast.success(
        "Versión recuperada como nuevo borrador. Revísala y déjala lista para usar cuando quieras.",
      );
      setRestoreVersion(null);
      onOpenChange(false);
      onRestored();
    },
    onError: failure,
  });
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent title="Historial de cambios">
          <div className="flex items-center justify-between border-b border-border p-5">
            <div>
              <h2 className="text-lg font-semibold">Historial del proceso</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {definition.name}
              </p>
            </div>
            <SheetClose asChild>
              <Button size="icon" variant="ghost" aria-label="Cerrar historial">
                <X />
              </Button>
            </SheetClose>
          </div>
          <div className="overflow-y-auto p-5">
            {versions.isPending ? (
              <p role="status">Cargando versiones…</p>
            ) : versions.isError ? (
              <p role="alert">
                No se pudo cargar el historial.{" "}
                <button
                  className="underline"
                  onClick={() => versions.refetch()}
                >
                  Reintentar
                </button>
              </p>
            ) : (
              <ol className="divide-y divide-border">
                {versions.data?.map((v) => (
                  <li key={v.id} className="py-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-medium">Versión {v.version}</h3>
                      <span className="text-xs text-muted-foreground">
                        {v.published
                          ? "Lista para usar"
                          : v.version === definition.version
                            ? "Actual"
                            : "Anterior"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {v.flow?.steps.length ?? 0} pasos ·{" "}
                      {v.flow?.variables.length ?? 0} datos
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={v.version === definition.version}
                        onClick={() => setCompare(v.version)}
                      >
                        Comparar con actual
                      </Button>
                      {admin && v.version !== definition.version && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRestoreVersion(v.version)}
                        >
                          Recuperar
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {older && (
              <section className="mt-6 border-t border-border pt-5">
                <h3 className="font-semibold">
                  v{older.version} → v{definition.version}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Campos que cambiaron entre ambas versiones:
                </p>
                <ul className="mt-3 list-disc space-y-2 pl-4 text-sm">
                  {versionChanges(older, definition).map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
                {!versionChanges(older, definition).length && (
                  <p className="mt-3 text-sm">
                    La configuración es equivalente.
                  </p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium">v{older.version}</p>
                    <p>
                      {older.flow?.order === "PARALELO"
                        ? "Paralelo"
                        : "Secuencial"}{" "}
                      · {older.flow?.slaHours ?? "—"} h
                    </p>
                    {older.flow?.steps.map((s) => (
                      <div className="mt-3 break-words" key={s.id}>
                        <p className="font-medium">{s.label}</p>
                        <p className="mt-1 text-muted-foreground">
                          {describeWho(s.who)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {describeWhen(s.when, older.flow!.variables)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="font-medium">Actual</p>
                    <p>
                      {definition.flow?.order === "PARALELO"
                        ? "Paralelo"
                        : "Secuencial"}{" "}
                      · {definition.flow?.slaHours ?? "—"} h
                    </p>
                    {definition.flow?.steps.map((s) => (
                      <div className="mt-3 break-words" key={s.id}>
                        <p className="font-medium">{s.label}</p>
                        <p className="mt-1 text-muted-foreground">
                          {describeWho(s.who)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {describeWhen(s.when, definition.flow!.variables)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={restoreVersion !== null}
        onOpenChange={(value) => {
          if (!value) setRestoreVersion(null);
        }}
        title={`¿Recuperar la versión ${restoreVersion}?`}
        description="Se creará un nuevo borrador con esta configuración. Las versiones anteriores y las solicitudes en curso conservarán su historial."
        confirmLabel="Crear borrador recuperado"
        pending={restore.isPending}
        onConfirm={() => {
          if (restoreVersion !== null) restore.mutate(restoreVersion);
        }}
      />
    </>
  );
}
