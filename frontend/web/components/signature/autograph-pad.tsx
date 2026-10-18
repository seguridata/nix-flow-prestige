"use client";

import { useEffect, useRef } from "react";
import SignaturePad from "signature_pad";
import { Button } from "@/components/ui/button";

export function AutographPad({
  onChange,
}: {
  onChange: (png: Blob | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!canvas.getContext("2d")) return;

    function fit() {
      if (!canvas) return;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const width = canvas.offsetWidth || 480;
      const height = canvas.offsetHeight || 160;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
      padRef.current?.clear();
      onChangeRef.current(null);
    }

    const pad = new SignaturePad(canvas, {
      penColor: "#191919",
      minWidth: 1.1,
      maxWidth: 2.8,
      throttle: 8,
    });
    pad.addEventListener("endStroke", () => {
      if (pad.isEmpty()) {
        onChangeRef.current(null);
        return;
      }
      canvas.toBlob((blob) => onChangeRef.current(blob), "image/png");
    });
    padRef.current = pad;
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      pad.clear();
      padRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-white p-3">
      <p className="text-sm font-medium text-foreground">Traza tu firma en el recuadro</p>
      <p className="text-xs text-muted-foreground">Usá el mouse o el dedo. El trazo se incrusta en el PDF.</p>
      <canvas
        ref={canvasRef}
        className="h-40 w-full cursor-crosshair rounded-md border border-border bg-[#fafafa]"
        aria-label="Lienzo para trazar la firma autógrafa"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          padRef.current?.clear();
          onChangeRef.current(null);
        }}
      >
        Borrar trazo
      </Button>
    </div>
  );
}
