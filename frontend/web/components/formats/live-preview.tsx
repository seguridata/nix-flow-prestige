"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { PdfSurface, useContainerWidth } from "@/components/formats/pdf-surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/libs/utils";
import { formatPdfUrl, type FormatDetail } from "@/services/formats-service";

/** El PDF final imprime las fechas como DD/MM/AAAA; la vista previa debe verse igual. */
const shown = (type: string, v: string) => (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split("-").reverse().join("/") : v);

/**
 * El documento a la vista mientras se llena el formato: cada dato se escribe en su lugar de la hoja al teclearlo.
 * Los lugares todavía vacíos se insinúan con un contorno tenue y el dato que se está editando se resalta con su
 * nombre, para que se entienda dónde caerá lo que se escribe. Con varias páginas se puede pasar de una a otra, y si se
 * enfoca un dato de otra página la vista salta sola. Es solo una guía: el documento final lo genera el servidor.
 */
export function LivePreview({
  format,
  values,
  activeKey,
}: {
  format: Pick<FormatDetail, "id" | "fields" | "pageCount">;
  values: Readonly<Record<string, string>>;
  /** Clave del dato que tiene el foco en el formulario (si hay uno). */
  activeKey: string | null;
}) {
  const { ref, width } = useContainerWidth(560);
  const fontScale = width / 612;
  const [page, setPage] = useState(1);
  const pages = Math.max(1, format.pageCount);

  const active = activeKey ? format.fields.find((f) => f.key === activeKey) : undefined;
  // Al enfocar un dato de otra página la vista salta a ella (se ajusta durante el render, sin efecto).
  const activePage = active?.page;
  const [followed, setFollowed] = useState<number | undefined>(undefined);
  if (activePage !== followed) {
    setFollowed(activePage);
    if (activePage && activePage <= pages) setPage(activePage);
  }

  const onPage = useMemo(() => format.fields.filter((f) => f.page === page), [format.fields, page]);
  const filled = format.fields.filter((f) => (values[f.key] ?? "") !== "").length;
  const total = format.fields.length;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden className="size-2 rounded-full bg-emerald-600 motion-safe:animate-pulse" />
          Así va quedando
        </p>
        {total > 0 ? (
          <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {filled} de {total} {total === 1 ? "dato" : "datos"} en el documento
          </p>
        ) : null}
      </div>

      <div ref={ref} className="min-w-0">
        <PdfSurface file={formatPdfUrl(format.id)} page={page} width={width}>
          <div aria-hidden>
            {onPage.map((f) => {
              const value = values[f.key] ?? "";
              const isActive = f.key === activeKey;
              const nearTop = f.y < 0.06;
              return (
                <span
                  key={f.key}
                  data-field={f.key}
                  className={cn(
                    "pointer-events-none absolute flex items-center overflow-visible whitespace-nowrap rounded-[2px] px-[2px] leading-none text-black motion-safe:transition-[background-color,box-shadow] motion-safe:duration-150",
                    isActive
                      ? "z-10 bg-primary/15 ring-2 ring-primary"
                      : value
                        ? "bg-transparent"
                        : "bg-foreground/[0.04] outline outline-1 -outline-offset-1 outline-dashed outline-foreground/25",
                  )}
                  style={{
                    left: `${f.x * 100}%`,
                    top: `${f.y * 100}%`,
                    width: `${f.w * 100}%`,
                    height: `${f.h * 100}%`,
                    fontSize: `${(f.fontSize ?? 11) * fontScale}px`,
                    justifyContent: f.align === "center" ? "center" : "flex-start",
                    fontFamily: "Helvetica, Arial, sans-serif",
                  }}
                >
                  <span className="min-w-0 overflow-hidden text-ellipsis">{shown(f.type, value)}</span>
                  {isActive ? (
                    <span
                      className={cn(
                        "absolute left-0 max-w-[16rem] truncate rounded-sm bg-foreground px-1.5 py-1 font-sans text-[11px] font-medium leading-none text-background",
                        nearTop ? "top-full mt-1" : "bottom-full mb-1",
                      )}
                    >
                      {f.label || f.key}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>
        </PdfSurface>
      </div>

      {pages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Página anterior">
            <ChevronLeft aria-hidden /> Anterior
          </Button>
          <p className="text-xs tabular-nums text-muted-foreground">
            Página {page} de {pages}
          </p>
          <Button type="button" variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} aria-label="Página siguiente">
            Siguiente <ChevronRight aria-hidden />
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Es una guía: el documento final con las firmas lo genera el sistema al enviar.</p>
    </div>
  );
}
