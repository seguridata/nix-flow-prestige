import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/libs/utils";

/** Select nativo (accesible y cómodo en móvil) con la misma altura y foco que `Input`. */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "h-11 w-full appearance-none rounded-md border border-input bg-background pl-3.5 pr-10 text-sm text-foreground shadow-subtle outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { Select };
