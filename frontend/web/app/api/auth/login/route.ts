import { NextResponse, type NextRequest } from "next/server";
import {
  authorizeUrl,
  clientForTenant,
  CLIENT_COOKIE,
  newPkcePair,
  newState,
  PKCE_COOKIE,
  STATE_COOKIE,
} from "@/libs/auth";

export const dynamic = "force-dynamic";

/**
 * Inicia el flujo OIDC: guarda verifier + state y redirige a Keycloak.
 * `?tenant=<slug>` elige el cliente OIDC del tenant (y con él su tema de login).
 */
export function GET(req: NextRequest) {
  const { verifier, challenge } = newPkcePair();
  const state = newState();
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/";
  const maxAge = Number(req.nextUrl.searchParams.get("maxAge") ?? "");
  const clientId = clientForTenant(req.nextUrl.searchParams.get("tenant"));

  const res = NextResponse.redirect(
    authorizeUrl(
      challenge,
      state,
      Number.isFinite(maxAge) && maxAge > 0 ? maxAge : undefined,
      clientId,
    ),
  );
  const opts = {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
  res.cookies.set(PKCE_COOKIE, verifier, opts);
  res.cookies.set(STATE_COOKIE, `${state}|${returnTo}`, opts);
  res.cookies.set(CLIENT_COOKIE, clientId, opts);
  return res;
}
