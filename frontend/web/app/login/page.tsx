import type { Route } from "next";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { getValidSession } from "@/libs/auth";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  state_mismatch: "La sesión de inicio no coincide. Vuelve a intentarlo.",
  token_exchange: "No se pudo completar el inicio de sesión. Vuelve a intentarlo.",
  bad_request: "Faltaron datos en la respuesta del inicio de sesión. Vuelve a intentarlo.",
  access_denied: "No tienes acceso a Prestige con esta cuenta. Pide acceso a tu administrador.",
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
    <main className="flex min-h-dvh items-center justify-center bg-secondary px-6 py-10 text-secondary-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-center gap-3">
          <img src="/brand/seguridata-logo.png" alt="" className="size-10 rounded-md object-contain" width={40} height={40} />
          <span className="flex flex-col leading-none">
            <span className="text-xl font-semibold tracking-tight">Prestige</span>
            <span className="mt-1 text-sm text-secondary-foreground/70">por SeguriData</span>
          </span>
        </div>

        <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight">Inicia sesión</h1>
        <p className="mt-3 text-base text-secondary-foreground/70">
          Entra con tu cuenta corporativa para enviar documentos a firma y consultar su evidencia.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-md border border-white/25 bg-white/10 px-4 py-3 text-sm"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {ERRORS[error] ?? "No se pudo iniciar sesión. Vuelve a intentarlo."}
          </p>
        ) : null}

        {/* Navegación dura (no <Link>): el handler responde 307 a Keycloak y el
            navegador la sigue como navegación normal — un fetch cruzado a
            Keycloak lo bloquearía CORS. */}
        <a
          href={loginHref}
          className="mt-8 inline-flex h-12 w-full items-center justify-center rounded-md bg-primary px-5 text-base font-semibold text-primary-foreground outline-none transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-secondary active:scale-[0.98]"
        >
          Entrar con mi cuenta
        </a>
      </div>
    </main>
  );
}
