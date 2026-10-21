"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { FilePlus2, LogOut, Menu, Search } from "lucide-react";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { isActive, visibleGroups, type NavGroup } from "@/components/layout/nav-config";
import { ProductTourButton } from "@/components/tour/product-tour";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import { SeguriDataLogo } from "@/components/brand/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/libs/utils";
import { useSession } from "@/store/session-store";
import { ChatPanel } from "@/components/chat/chat-panel";
import { CommandPalette, useCommandPalette } from "@/components/command/command-palette";

function NavList({
  groups,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-5" aria-label="Principal" data-tour="nav">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-xs font-medium text-white/45">{group.label}</p>
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.hint}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                data-tour={item.href === "/overview" ? "overview" : undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary",
                  active
                    ? "bg-white/10 font-medium text-white"
                    : "text-white/70 hover:bg-white/5 hover:text-white",
                )}
              >
                {active ? (
                  <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
                ) : null}
                <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

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
  const groups = visibleGroups(roles);
  const palette = useCommandPalette();
  const [menuOpen, setMenuOpen] = useState(false);
  const canSend = roles.includes("sender") || roles.includes("admin");
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Saltar al contenido
      </a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col bg-secondary text-secondary-foreground md:flex">
        <div className="px-5 pb-4 pt-5">
          <SeguriDataLogo inverted />
        </div>
        {canSend ? (
          <div className="px-3 pb-4">
            <Link
              href="/new"
              className="flex h-10 items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground outline-none transition-[filter,transform] duration-150 hover:brightness-95 focus-visible:ring-2 focus-visible:ring-white active:scale-[0.98]"
            >
              <FilePlus2 className="size-4" strokeWidth={2} />
              Enviar documento
            </Link>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <NavList groups={groups} pathname={pathname} />
        </div>
        <button
          type="button"
          onClick={() => palette.setOpen(true)}
          className="mx-3 mb-4 flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-white/60 outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Search className="size-3.5" />
          Buscar documentos y personas
          <kbd className="ml-auto font-mono text-[10px] text-white/40">Ctrl K</kbd>
        </button>
      </aside>

      <div className="md:pl-[248px]">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="md:hidden">
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger className="rounded-md p-2 hover:bg-muted" aria-label="Abrir menú">
                  <Menu className="size-5" />
                </SheetTrigger>
                <SheetContent title="Navegación" className="overflow-y-auto bg-secondary text-secondary-foreground">
                  <div className="px-5 pb-4 pt-5">
                    <SeguriDataLogo inverted />
                  </div>
                  {canSend ? (
                    <div className="px-3 pb-4">
                      <Link
                        href="/new"
                        onClick={() => setMenuOpen(false)}
                        className="flex h-11 items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground"
                      >
                        <FilePlus2 className="size-4" />
                        Enviar documento
                      </Link>
                    </div>
                  ) : null}
                  <div className="px-3 pb-6">
                    <NavList groups={groups} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
            <div className="truncate text-sm font-medium text-foreground">{title}</div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {actions}
            <button
              type="button"
              onClick={() => palette.setOpen(true)}
              aria-label="Buscar"
              className="rounded-md p-2 text-muted-foreground hover:bg-muted md:hidden"
            >
              <Search className="size-4" />
            </button>
            <div className="hidden sm:block">
              <ProductTourButton />
            </div>
            <div data-tour="notify">
              <NotificationsBell />
            </div>
            <Popover>
              <PopoverTrigger
                aria-label="Cuenta"
                className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="size-9">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-0">
                <div className="border-b border-border px-4 py-3">
                  <p className="truncate text-sm font-medium">{name}</p>
                  {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
                  {roles.length ? (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">{roles.join(" · ")}</p>
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
          id="contenido"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.215, 0.61, 0.355, 1] }}
          className="px-4 py-6 sm:px-8 sm:py-8"
        >
          {children}
        </motion.main>
      </div>
      {roles.includes("admin") ? <ChatPanel /> : null}
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </div>
  );
}
