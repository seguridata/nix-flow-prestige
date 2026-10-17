"use client";

import { useEffect, useRef, useState } from "react";
import "@/components/bpm/bpmn-styles";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css";

type SaveXml = () => Promise<string>;
interface Modeler {
  importXML: (xml: string) => Promise<unknown>;
  saveXML: (options: { format: boolean }) => Promise<{ xml?: string }>;
  destroy: () => void;
  get: (name: string) => { zoom?: (value: string) => void; on?: (event: string, callback: () => void) => void };
}

/** The process page keeps this modeler mounted across tabs, preserving its undo history. */
export function BpmnStudio({ xml, visible, onReady, onDirtyChange }: {
  xml: string;
  visible: boolean;
  onReady: (save: SaveXml | null) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const modeler = useRef<Modeler | null>(null);
  const callbacks = useRef({ onReady, onDirtyChange });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { callbacks.current = { onReady, onDirtyChange }; });

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    let instance: Modeler | null = null;
    callbacks.current.onReady(null);
    callbacks.current.onDirtyChange(false);
    setError(null);
    async function mount() {
      try {
        const [{ default: BpmnModeler }, { default: TokenSimulation }] = await Promise.all([
          import("bpmn-js/lib/Modeler"), import("bpmn-js-token-simulation"),
        ]);
        if (disposed || !host.current) return;
        instance = new BpmnModeler({ container: host.current, additionalModules: [TokenSimulation] }) as unknown as Modeler;
        modeler.current = instance;
        await instance.importXML(xml);
        const imported = (await instance.saveXML({ format: true })).xml ?? xml;
        if (disposed) return;
        const save: SaveXml = async () => {
          const result = await instance!.saveXML({ format: true });
          if (!result.xml) throw new Error("El diagrama no produjo XML válido. Intenta guardarlo otra vez.");
          return result.xml;
        };
        instance.get("eventBus").on?.("commandStack.changed", () => {
          // Mark immediately, so navigation cannot race an asynchronous serialization.
          const current = ++revision;
          callbacks.current.onDirtyChange(true);
          void save().then((next) => {
            if (!disposed && current === revision) callbacks.current.onDirtyChange(next !== imported);
          }).catch(() => { /* Keep the dirty guard if serialization fails. */ });
        });
        callbacks.current.onReady(save);
        instance.get("canvas").zoom?.("fit-viewport");
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "No se pudo abrir el diagrama.");
      }
    }
    void mount();
    return () => {
      disposed = true;
      callbacks.current.onReady(null);
      instance?.destroy();
      if (modeler.current === instance) modeler.current = null;
    };
  }, [xml]);

  useEffect(() => {
    if (visible) modeler.current?.get("canvas").zoom?.("fit-viewport");
  }, [visible]);

  return <div className="relative h-full min-h-96">
    {error && <p role="alert" className="absolute inset-x-4 top-4 z-10 rounded-md bg-background p-3 text-sm text-destructive">No se pudo cargar el BPMN: {error}</p>}
    <div ref={host} className="bpmn-studio h-full min-h-96 w-full overflow-hidden bg-white"/>
  </div>;
}
