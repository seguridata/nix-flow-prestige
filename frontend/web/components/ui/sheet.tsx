"use client";

import * as React from "react";
import { Drawer as Vaul } from "vaul";
import { cn } from "@/libs/utils";

function Sheet({
  children,
  direction = "right",
  ...props
}: React.ComponentProps<typeof Vaul.Root> & { direction?: "right" | "left" | "bottom" | "top" }) {
  return (
    <Vaul.Root direction={direction} shouldScaleBackground={false} {...props}>
      {children}
    </Vaul.Root>
  );
}

function SheetTrigger(props: React.ComponentProps<typeof Vaul.Trigger>) {
  return <Vaul.Trigger {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof Vaul.Close>) {
  return <Vaul.Close {...props} />;
}

function SheetContent({
  className,
  children,
  title,
  ...props
}: React.ComponentProps<typeof Vaul.Content> & { title?: string }) {
  return (
    <Vaul.Portal>
      <Vaul.Overlay className="fixed inset-0 z-50 bg-brand-carbon/40 backdrop-blur-[2px]" />
      <Vaul.Content
        className={cn(
          "fixed z-50 flex flex-col bg-card shadow-elevated outline-none",
          "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:w-[min(420px,100vw)]",
          "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:max-h-[88vh] data-[vaul-drawer-direction=bottom]:rounded-t-xl",
          className,
        )}
        {...props}
      >
        <Vaul.Title className="sr-only">{title ?? "Panel"}</Vaul.Title>
        <div className="mx-auto mt-3 hidden h-1 w-10 rounded-full bg-border data-[vaul-drawer-direction=bottom]:block" />
        {children}
      </Vaul.Content>
    </Vaul.Portal>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent };
