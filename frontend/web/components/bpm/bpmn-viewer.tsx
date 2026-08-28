"use client";

import { useEffect, useRef } from "react";
import "./bpmn-styles";

export function BpmnViewer({ xml }: { xml: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!xml || !ref.current) return;
    let destroyed = false;
    let viewer: { importXML: (x: string) => Promise<unknown>; destroy: () => void; get: (n: string) => { zoom: (t: string) => void } } | null =
      null;

    (async () => {
      const BpmnJS = (await import("bpmn-js/lib/NavigatedViewer")).default;
      if (destroyed || !ref.current) return;
      viewer = new BpmnJS({ container: ref.current });
      await viewer.importXML(xml);
      viewer.get("canvas").zoom("fit-viewport");
    })();

    return () => {
      destroyed = true;
      viewer?.destroy();
    };
  }, [xml]);

  return <div ref={ref} className="h-[68vh] w-full overflow-hidden rounded-md bg-white" />;
}
