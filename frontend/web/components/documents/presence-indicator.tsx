"use client";

import { AnimatePresence, motion } from "motion/react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/libs/utils";
import type { PresenceState } from "@/libs/types";

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface PresenceIndicatorProps {
  actors: PresenceState[];
  className?: string;
}

/**
 * Avatares superpuestos de quién más está viendo este documento ahora
 * mismo. Discreto a propósito: sin resplandor ni color de marca a gran
 * escala, solo un contorno claro para separar cada avatar del siguiente.
 */
export function PresenceIndicator({ actors, className }: PresenceIndicatorProps) {
  if (actors.length === 0) return null;

  const visible = actors.slice(0, 4);
  const extra = actors.length - visible.length;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex -space-x-2">
        <AnimatePresence initial={false}>
          {visible.map((actor) => (
            <motion.div
              key={actor.actorId}
              initial={{ opacity: 0, scale: 0.85, x: 6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <Avatar className="size-7 border-2 border-background" title={actor.actorName}>
                <AvatarFallback className="text-[10px]">
                  {initialsOf(actor.actorName)}
                </AvatarFallback>
              </Avatar>
            </motion.div>
          ))}
        </AnimatePresence>
        {extra > 0 ? (
          <div className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold text-muted-foreground">
            +{extra}
          </div>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">
        {actors.length === 1 && actors[0]
          ? `${actors[0].actorName.split(" ")[0]} está viendo esto`
          : `${actors.length} personas viendo esto`}
      </span>
    </div>
  );
}
