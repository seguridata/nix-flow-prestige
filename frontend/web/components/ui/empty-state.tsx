import * as React from "react";

import { cn } from "@/libs/utils";

/** Estado vacío con salida: dice qué es esto, por qué está vacío y qué hacer a continuación. */
function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 sm:items-center sm:text-center",
        className,
      )}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-md bg-background text-muted-foreground shadow-subtle [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="max-w-[52ch] text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
