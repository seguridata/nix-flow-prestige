"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  FilePlus2,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Search,
  Send,
  Server,
  UserPlus,
} from "lucide-react";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { ProductTourButton } from "@/components/tour/product-tour";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import { SeguriDataLogo } from "@/components/brand/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";
import { CommandPalette, useCommandPalette } from "@/components/command/command-palette";

const NAV: { href: Route; label: string; icon: typeof Inbox }[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/inbox", label: "Bandeja", icon: Inbox },
  { href: "/sent", label: "Enviados", icon: Send },
  { href: "/new", label: "Enviar", icon: FilePlus2 },
  { href: "/onboarding", label: "Onboarding", icon: UserPlus },
  { href: "/tasks", label: "Tareas", icon: ListChecks },
  { href: "/process", label: "Proceso", icon: GitBranch },
  { href: "/operations", label: "Operación", icon: Server },
];

export function AppShell({
  children,
  title,
  actions,
}: {
  children: React.ReactNode;
  title?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const { name, email, roles } = useSession();
  const palette = useCommandPalette();
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[220px] flex-col bg-secondary text-secondary-foreground md:flex">
        <div className="px-5 py-5">
          <SeguriDataLogo inverted />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3" data-tour="nav">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-tour={item.href === "/overview" ? "overview" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                  active ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                {item.label}
                {active ? <span className="ml-auto size-1.5 rounded-full bg-primary" /> : null}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => palette.setOpen(true)}
          className="mx-3 mb-4 flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-white/60 transition-colors hover:bg-white/5"
        >
          <Search className="size-3.5" />
          Buscar
          <kbd className="ml-auto font-mono text-[10px] text-white/40">⌘K</kbd>
        </button>
      </aside>

      <div className="md:pl-[220px]">
        <header className="glass sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-3 md:hidden">
            <Sheet>
              <SheetTrigger className="rounded-md p-2 hover:bg-muted" aria-label="Menú">
                <Menu className="size-4" />
              </SheetTrigger>
              <SheetContent title="Navegación" className="bg-secondary text-secondary-foreground">
                <div className="px-5 py-5">
                  <SeguriDataLogo inverted />
                </div>
                <nav className="flex flex-col gap-1 px-3">
                  {NAV.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                      >
                        <Icon className="size-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </SheetContent>
            </Sheet>
            <SeguriDataLogo />
          </div>
          <div className="hidden text-sm font-medium text-foreground md:block">{title}</div>
          <div className="flex items-center gap-3">
            {actions}
            <div className="hidden sm:block">
              <ProductTourButton />
            </div>
            <div data-tour="notify">
              <NotificationsBell />
            </div>
            <Popover>
              <PopoverTrigger className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="size-9">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60 p-0">
                <div className="border-b border-border px-4 py-3">
                  <p className="truncate text-sm font-medium">{name}</p>
                  {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
                  {roles.length ? (
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                      {roles.join(" · ")}
                    </p>
                  ) : null}
                </div>
                <a
                  href="/api/auth/logout"
                  className="flex items-center gap-2 px-4 py-3 text-sm text-foreground hover:bg-muted"
                >
                  <LogOut className="size-4" /> Cerrar sesión
                </a>
              </PopoverContent>
            </Popover>
          </div>
        </header>
        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.215, 0.61, 0.355, 1] }}
          className="px-5 py-8 sm:px-8"
        >
          {children}
        </motion.main>
      </div>
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </div>
  );
}
