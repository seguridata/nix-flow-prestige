"use client";

import { useCallback, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { X } from "lucide-react";

import { cn } from "@/libs/utils";
import type { SignatureFieldType } from "@/libs/types";
import type { DraftField, SignerColor } from "./field-editor-types";

// react-pdf needs the pdf.js worker to parse/render in the browser. Pulling
// it from the CDN (pinned to the exact pdfjs-dist version react-pdf ships)
// avoids bundler asset-resolution edge cases with Turbopack.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Ref. estable (si no, react-pdf recarga en cada render). `disableRange` evita
// que pdf.js pida rangos a un endpoint que descifra al vuelo y no los soporta.
const PDF_OPTIONS = { disableRange: true } as const;

const MIN_DRAG_PCT = 0.012;
const MIN_FIELD_PCT = 0.03;

interface SignatureFieldCanvasProps {
  // URL same-origin del PDF. Con http(s), pdf.js usa PDFFetchStream (fetch +
  // Headers reales): ni el bug de _onHeadersReceived con `blob:`, ni la
  // transferencia del ArrayBuffer que rompe el 2º parse en StrictMode.
  fileUrl: string;
  pageNumber: number;
  pageWidth: number;
  onNumPages: (n: number) => void;
  fieldsOnPage: DraftField[];
  colorFor: (signerId: string) => SignerColor;
  defaultSize: (type: SignatureFieldType) => { w: number; h: number };
  activeSignerId: string | null;
  activeType: SignatureFieldType;
  canPlace: boolean;
  onPlaceField: (rect: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  onRemoveField: (key: string) => void;
  labelFor: (type: SignatureFieldType) => string;
  initialsFor: (signerId: string) => string;
}

export function SignatureFieldCanvas({
  fileUrl,
  pageNumber,
  pageWidth,
  onNumPages,
  fieldsOnPage,
  colorFor,
  defaultSize,
  activeSignerId,
  activeType,
  canPlace,
  onPlaceField,
  onRemoveField,
  labelFor,
  initialsFor,
}: SignatureFieldCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const pctFromEvent = useCallback((clientX: number, clientY: number) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return { x, y };
  }, []);

  function handleMouseDown(e: React.MouseEvent) {
    if (!canPlace) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const start = pctFromEvent(e.clientX, e.clientY);
    const initial = { x0: start.x, y0: start.y, x1: start.x, y1: start.y };
    dragRef.current = initial;
    setDrag(initial);

    function handleMove(ev: MouseEvent) {
      const p = pctFromEvent(ev.clientX, ev.clientY);
      setDrag((prev) => {
        if (!prev) return prev;
        const next = { ...prev, x1: p.x, y1: p.y };
        dragRef.current = next;
        return next;
      });
    }

    function handleUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      const end = pctFromEvent(ev.clientX, ev.clientY);
      const start = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!start) return;

      const x0 = Math.min(start.x0, end.x);
      const y0 = Math.min(start.y0, end.y);
      const dw = Math.abs(end.x - start.x0);
      const dh = Math.abs(end.y - start.y0);

      let rect: { xPct: number; yPct: number; widthPct: number; heightPct: number };
      if (dw < MIN_DRAG_PCT && dh < MIN_DRAG_PCT) {
        const { w, h } = defaultSize(activeType);
        rect = {
          xPct: Math.min(Math.max(start.x0 - w / 2, 0), 1 - w),
          yPct: Math.min(Math.max(start.y0 - h / 2, 0), 1 - h),
          widthPct: w,
          heightPct: h,
        };
      } else {
        const widthPct = Math.max(dw, MIN_FIELD_PCT);
        const heightPct = Math.max(dh, MIN_FIELD_PCT);
        rect = {
          xPct: Math.min(x0, 1 - widthPct),
          yPct: Math.min(y0, 1 - heightPct),
          widthPct,
          heightPct,
        };
      }
      queueMicrotask(() => onPlaceField(rect));
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  const draftRectStyle =
    drag && (Math.abs(drag.x1 - drag.x0) > 0.002 || Math.abs(drag.y1 - drag.y0) > 0.002)
      ? {
          left: `${Math.min(drag.x0, drag.x1) * 100}%`,
          top: `${Math.min(drag.y0, drag.y1) * 100}%`,
          width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
          height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
        }
      : null;

  const activeColor = activeSignerId ? colorFor(activeSignerId) : null;

  return (
    <Document
      file={fileUrl}
      options={PDF_OPTIONS}
      onLoadSuccess={({ numPages }) => onNumPages(numPages)}
      loading={<div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">Cargando PDF…</div>}
      error={
        <div className="flex h-[70vh] items-center justify-center text-sm text-destructive">
          No se pudo renderizar el PDF.
        </div>
      }
    >
      <div
        ref={wrapperRef}
        onMouseDown={handleMouseDown}
        className={cn(
          "relative inline-block select-none",
          canPlace ? "cursor-crosshair" : "cursor-default",
        )}
      >
        <Page
          pageNumber={pageNumber}
          width={pageWidth}
          renderAnnotationLayer={false}
          renderTextLayer={false}
        />

        {fieldsOnPage.map((field) => {
          const color = colorFor(field.signerId);
          return (
            <div
              key={field.key}
              className="absolute flex items-center justify-between gap-1 overflow-hidden rounded-[3px] border-2 px-1.5 text-[10px] font-medium shadow-subtle"
              style={{
                left: `${field.xPct * 100}%`,
                top: `${field.yPct * 100}%`,
                width: `${field.widthPct * 100}%`,
                height: `${field.heightPct * 100}%`,
                borderColor: color.border,
                backgroundColor: color.bg,
                color: color.text,
              }}
            >
              <span className="truncate">
                {labelFor(field.type)} · {initialsFor(field.signerId)}
              </span>
              <button
                type="button"
                aria-label="Quitar campo"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onRemoveField(field.key)}
                className="shrink-0 rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100"
                style={{ backgroundColor: color.border, color: "#fff" }}
              >
                <X className="size-2.5" strokeWidth={2.5} />
              </button>
            </div>
          );
        })}

        {draftRectStyle ? (
          <div
            className="pointer-events-none absolute rounded-[3px] border-2 border-dashed"
            style={{
              ...draftRectStyle,
              borderColor: activeColor?.border ?? "var(--brand-green)",
              backgroundColor: activeColor?.bg ?? "rgba(132,189,0,0.12)",
            }}
          />
        ) : null}
      </div>
    </Document>
  );
}
