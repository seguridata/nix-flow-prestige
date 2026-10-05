"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { SessionContext, type SessionUser } from "@/store/session-store";

function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const skip =
    pathname === "/login" ||
    pathname.startsWith("/verificar") ||
    pathname.startsWith("/firmar");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
        if (!r.ok) throw new Error(`auth/me ${r.status}`);
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
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [skip, attempt]);

  if (skip) return <>{children}</>;

  if (failed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <p className="text-sm font-medium">No se pudo cargar tu sesión.</p>
        <p className="text-xs text-muted-foreground">Revisa tu conexión e inténtalo de nuevo.</p>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }

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
