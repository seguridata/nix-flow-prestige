import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/libs/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-subtle hover:brightness-95 active:brightness-90",
        secondary:
          "bg-secondary text-secondary-foreground shadow-subtle hover:bg-brand-carbon-soft",
        outline:
          "border border-border bg-background hover:bg-muted text-foreground",
        ghost: "hover:bg-muted text-foreground",
        link: "text-primary underline-offset-4 hover:underline p-0 h-auto",
        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-95",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-9 px-3.5 text-sm",
        lg: "h-12 px-7 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
