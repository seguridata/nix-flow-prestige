"use client";

import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { cn } from "@/libs/utils";

const HoverCard = HoverCardPrimitive.Root;
const HoverCardTrigger = HoverCardPrimitive.Trigger;

function HoverCardContent({
  className,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Content
      sideOffset={8}
      className={cn(
        "z-50 w-72 rounded-lg border border-border bg-card p-4 shadow-elevated outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
