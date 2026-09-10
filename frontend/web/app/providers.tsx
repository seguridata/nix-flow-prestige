"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { SessionContext, type SessionUser } from "@/store/session-store";

function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const skip = pathname === "/login" || pathname.startsWith("/verificar");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (skip) return;
    let alive = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 401) {
          window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        const data = await r.json();
        setUser({
          signerId: data.actorId,
          name: data.name,
          email: data.email,
          roles: data.roles ?? [],
          tenantId: data.tenantId ?? "seguridata",
        });
        setReady(true);
      })
      .catch(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [skip]);

  if (skip) return <>{children}</>;

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--brand-carbon)",
            color: "var(--brand-white)",
            border: "1px solid rgba(255,255,255,0.08)",
          },
        }}
      />
    </QueryClientProvider>
  );
}
