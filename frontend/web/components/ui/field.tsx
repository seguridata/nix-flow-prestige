import * as React from "react";

import { cn } from "@/libs/utils";

/**
 * Etiqueta + control + ayuda + error. La etiqueta siempre se ve (no placeholder-as-label),
 * "(opcional)" solo en lo que no es obligatorio y el error va pegado al campo, en texto.
 */
function Field({
  label,
  htmlFor,
  optional,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  optional?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
        {optional ? <span className="ml-1.5 font-normal text-muted-foreground">(opcional)</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export { Field };
