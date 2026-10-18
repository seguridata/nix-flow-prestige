import { NextResponse, type NextRequest } from "next/server";
import {
  CLIENT_COOKIE,
  exchangeCode,
  knownClient,
  PKCE_COOKIE,
  sessionFromTokens,
  STATE_COOKIE,
  writeSessionCookie,
} from "@/libs/auth";

export const dynamic = "force-dynamic";

/** Vuelta de Keycloak: valida state, canjea el code y crea la sesión. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, req.url));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const verifier = req.cookies.get(PKCE_COOKIE)?.value;
  const stored = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !verifier || !stored) {
    return NextResponse.redirect(new URL("/login?error=bad_request", req.url));
  }
  const [expectedState, returnTo = "/"] = stored.split("|");
  if (state !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=state_mismatch", req.url));
  }

  try {
    const clientId = knownClient(req.cookies.get(CLIENT_COOKIE)?.value);
    const tokens = await exchangeCode(code, verifier, clientId);
    await writeSessionCookie(sessionFromTokens(tokens, clientId));
  } catch {
    return NextResponse.redirect(new URL("/login?error=token_exchange", req.url));
  }

  const res = NextResponse.redirect(new URL(returnTo.startsWith("/") ? returnTo : "/", req.url));
  res.cookies.delete(PKCE_COOKIE);
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(CLIENT_COOKIE);
  return res;
}
