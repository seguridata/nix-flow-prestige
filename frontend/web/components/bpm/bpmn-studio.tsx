"use client";

import { useEffect, useRef } from "react";
import "./bpmn-styles";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css";

type ModelerHandle = {
  importXML: (xml: string) => Promise<unknown>;
  saveXML: (opts?: { format?: boolean }) => Promise<{ xml?: string }>;
  destroy: () => void;
  get: (name: string) => { zoom?: (t: string) => void };
};

export function BpmnStudio({
  xml,
  onReady,
}: {
  xml: string;
  onReady?: (save: () => Promise<string>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<ModelerHandle | null>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    if (!xml || !ref.current) return;
    let destroyed = false;

    (async () => {
      const [{ default: BpmnModeler }, { default: TokenSimulationModule }] = await Promise.all([
        import("bpmn-js/lib/Modeler"),
        import("bpmn-js-token-simulation"),
      ]);
      if (destroyed || !ref.current) return;
      const modeler = new BpmnModeler({
        container: ref.current,
        additionalModules: [TokenSimulationModule],
      }) as unknown as ModelerHandle;
      modelerRef.current = modeler;
      await modeler.importXML(xml);
      modeler.get("canvas")?.zoom?.("fit-viewport");
      onReadyRef.current?.(async () => {
        const result = await modeler.saveXML({ format: true });
        return result.xml ?? xml;
      });
    })();

    return () => {
      destroyed = true;
      modelerRef.current?.destroy();
      modelerRef.current = null;
    };
  }, [xml]);

  return <div ref={ref} className="bpmn-studio h-[68vh] w-full overflow-hidden rounded-md bg-white" />;
}
