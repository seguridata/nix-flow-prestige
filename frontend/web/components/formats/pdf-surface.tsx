"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { cn } from "@/libs/utils";

// Mismo worker que el editor de campos de firma (CDN fijado a la versión exacta de pdfjs).
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
// Ref. estable (si no, react-pdf recarga en cada render); sin rangos porque el BFF descifra al vuelo.
const PDF_OPTIONS = { disableRange: true } as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ancho disponible del contenedor, para que la página del PDF ocupe todo el ancho sin desbordar. */
export function useContainerWidth(max = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(max);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.min(max, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [max]);
  return { ref, width };
}

/**
 * Una página de PDF con una capa encima en coordenadas fraccionales (0–1, origen arriba a la
 * izquierda). `children` se dibuja dentro de esa capa; con `onDraw` se puede trazar un rectángulo.
 */
export function PdfSurface({
  file,
  page,
  width,
  onPages,
  onDraw,
  children,
  className,
}: {
  /** URL same-origin del PDF o un File recién elegido. */
  file: string | File;
  page: number;
  width: number;
  onPages?: (n: number) => void;
  onDraw?: (r: Rect) => void;
  children?: React.ReactNode;
  className?: string;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [error, setError] = useState(false);

  const frac = useCallback((cx: number, cy: number) => {
    const r = layer.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { x: 0, y: 0 };
    return { x: Math.min(1, Math.max(0, (cx - r.left) / r.width)), y: Math.min(1, Math.max(0, (cy - r.top) / r.height)) };
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    if (!onDraw || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = frac(e.clientX, e.clientY);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = frac(e.clientX, e.clientY);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  }
  function onPointerUp() {
    if (!drag) return;
    const r = { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) };
    setDrag(null);
    if (r.w > 0.02 && r.h > 0.008) onDraw?.(r);
  }

  const ghost = drag
    ? { left: `${Math.min(drag.x0, drag.x1) * 100}%`, top: `${Math.min(drag.y0, drag.y1) * 100}%`, width: `${Math.abs(drag.x1 - drag.x0) * 100}%`, height: `${Math.abs(drag.y1 - drag.y0) * 100}%` }
    : null;

  return (
    <div className={cn("relative inline-block overflow-hidden rounded-md border border-border bg-white shadow-subtle", className)}>
      <Document
        file={file}
        options={PDF_OPTIONS}
        onLoadSuccess={(d) => onPages?.(d.numPages)}
        onLoadError={() => setError(true)}
        loading={<div className="grid place-items-center text-sm text-muted-foreground" style={{ width, height: width * 1.3 }}>Cargando el documento…</div>}
        error={<div role="alert" className="grid place-items-center p-6 text-sm" style={{ width, height: width * 1.3 }}>No se pudo mostrar el PDF.</div>}
      >
        <Page pageNumber={page} width={width} renderAnnotationLayer={false} renderTextLayer={false} />
      </Document>
      {error ? null : (
        <div
          ref={layer}
          className={cn("absolute inset-0 touch-none", onDraw && "cursor-crosshair")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {children}
          {ghost ? <div className="pointer-events-none absolute border-2 border-dashed border-foreground bg-primary/20" style={ghost} /> : null}
        </div>
      )}
    </div>
  );
}
