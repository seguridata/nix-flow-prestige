import * as React from "react";

import { cn } from "@/libs/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full rounded-md border border-input bg-background px-3.5 text-sm text-foreground shadow-subtle transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
