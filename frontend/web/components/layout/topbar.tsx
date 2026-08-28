import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface TopBarProps {
  userName?: string;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * Strategic carbon-black block per branding.md: headers carry the brand's
 * authority color, while the page body underneath stays light-dominant.
 */
export function TopBar({ userName = "María González", breadcrumb, actions }: TopBarProps) {
  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-black/10 bg-secondary px-6 text-secondary-foreground">
      <div className="flex items-center gap-3">
        <Link href="/inbox" className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" strokeWidth={2.25} aria-hidden />
          <span className="text-base font-semibold tracking-tight">Prestige</span>
        </Link>
        {breadcrumb ? (
          <>
            <span className="text-white/30">/</span>
            <div className="text-sm text-white/70">{breadcrumb}</div>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        {actions}
        <Avatar className="size-9 border border-white/15">
          <AvatarFallback className="bg-brand-carbon-soft text-white">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
