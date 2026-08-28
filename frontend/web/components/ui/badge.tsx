import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/libs/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium w-fit whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-muted text-muted-foreground border-transparent",
        success: "bg-[#eaf3d6] text-[#3f5900] border-transparent",
        warning: "bg-[#fdf1e0] text-[#a15c00] border-transparent",
        pending: "bg-[#eef2f6] text-[#3d4a56] border-transparent",
        destructive: "bg-[#fbe9e7] text-[#8c2018] border-transparent",
        outline: "border-border text-foreground bg-transparent",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
