import type { Route } from "next";
import { redirect } from "next/navigation";
import { SeguriDataLogo } from "@/components/brand/logo";
import { getValidSession } from "@/libs/auth";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  state_mismatch: "La sesión de inicio no coincide. Vuelve a intentar.",
  token_exchange: "No se pudo completar el inicio de sesión con Keycloak.",
  bad_request: "Faltan datos en la respuesta de Keycloak.",
  access_denied: "Acceso denegado.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const { error, returnTo = "/" } = await searchParams;
  const safeReturn = returnTo.startsWith("/") ? returnTo : "/";
  if (await getValidSession()) redirect(safeReturn as Route);

  const loginHref = `/api/auth/login?returnTo=${encodeURIComponent(safeReturn)}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary px-6 text-secondary-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <SeguriDataLogo inverted />
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-primary">Prestige</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Firma, workflow y evidencia verificable.
        </h1>
        <p className="mt-3 text-sm text-secondary-foreground/70">
          Inicia sesión con tu cuenta corporativa (Keycloak, realm <code>prestige</code>).
        </p>

        {error ? (
          <p className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
            {ERRORS[error] ?? "No se pudo iniciar sesión."}
          </p>
        ) : null}

        {/* Navegación dura (no <Link>): el handler responde 307 a Keycloak y el
            navegador la sigue como navegación normal — un fetch cruzado a
            Keycloak lo bloquearía CORS. */}
        <a
          href={loginHref}
          className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.98]"
        >
          Entrar
        </a>
      </div>
    </main>
  );
}
