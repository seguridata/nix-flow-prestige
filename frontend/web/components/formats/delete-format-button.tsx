"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/libs/utils";
import { deleteFormat } from "@/services/formats-service";

/**
 * Botón «Eliminar» de un formato (solo administrador; el servidor lo vuelve a exigir). Pide confirmación.
 * Los documentos ya enviados con el formato no se tocan.
 */
export function DeleteFormatButton({
  id,
  name,
  onDeleted,
  className,
  variant = "ghost",
}: {
  id: string;
  name: string;
  onDeleted?: () => void;
  className?: string;
  variant?: "ghost" | "outline";
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => deleteFormat(id),
    onSuccess: async () => {
      setOpen(false);
      toast.success("Formato eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["formats"] });
      queryClient.removeQueries({ queryKey: ["format", id] });
      onDeleted?.();
    },
    onError: (e: Error) => {
      setOpen(false);
      toast.error(e.message || "No se pudo eliminar el formato.");
    },
  });

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        aria-label={`Eliminar ${name}`}
        className={cn("text-destructive hover:text-destructive", className)}
        onClick={() => setOpen(true)}
      >
        <Trash2 /> Eliminar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`¿Eliminar «${name}»?`}
        description="Deja de aparecer en la biblioteca y no se puede recuperar. Los documentos que ya se enviaron con este formato no se tocan."
        confirmLabel="Eliminar formato"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
