import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, newPkcePair, newState, PKCE_COOKIE, STATE_COOKIE } from "@/libs/auth";

export const dynamic = "force-dynamic";

/** Inicia el flujo OIDC: guarda verifier + state y redirige a Keycloak. */
export function GET(req: NextRequest) {
  const { verifier, challenge } = newPkcePair();
  const state = newState();
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/";

  const res = NextResponse.redirect(authorizeUrl(challenge, state));
  const opts = {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
  res.cookies.set(PKCE_COOKIE, verifier, opts);
  res.cookies.set(STATE_COOKIE, `${state}|${returnTo}`, opts);
  return res;
}
