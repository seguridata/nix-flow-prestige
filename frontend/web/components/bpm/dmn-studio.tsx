"use client";

import { useEffect, useRef } from "react";
import "dmn-js/dist/assets/diagram-js.css";
import "dmn-js/dist/assets/dmn-js-shared.css";
import "dmn-js/dist/assets/dmn-js-drd.css";
import "dmn-js/dist/assets/dmn-js-decision-table.css";
import "dmn-js/dist/assets/dmn-js-literal-expression.css";
import "dmn-js/dist/assets/dmn-font/css/dmn-embedded.css";

type DmnHandle = {
  importXML: (xml: string) => Promise<{ warnings?: unknown[] }>;
  getViews: () => { type: string }[];
  open: (view: { type: string }) => void;
  destroy: () => void;
};

export function DmnStudio({ xml }: { xml: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!xml || !ref.current) return;
    let destroyed = false;
    let viewer: DmnHandle | null = null;

    (async () => {
      const { default: DmnModeler } = await import("dmn-js/lib/Modeler");
      if (destroyed || !ref.current) return;
      viewer = new DmnModeler({ container: ref.current }) as unknown as DmnHandle;
      await viewer.importXML(xml);
      const table = viewer.getViews().find((v) => v.type === "decisionTable");
      if (table) viewer.open(table);
    })();

    return () => {
      destroyed = true;
      viewer?.destroy();
    };
  }, [xml]);

  return <div ref={ref} className="dmn-studio min-h-[420px] w-full overflow-auto rounded-md bg-white p-2" />;
}
