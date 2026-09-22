import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import {
  dropSession,
  putSession,
  readSession,
  sessionStoreEnabled,
} from "./session-store";

/**
 * OIDC (Authorization Code + PKCE) contra Keycloak, patrón BFF: el navegador
 * nunca ve los tokens. La sesión vive en una cookie httpOnly firmada con
 * `SESSION_SECRET` (JWT compacto vía jose).
 */

export const SESSION_COOKIE = "prestige_session";
export const PKCE_COOKIE = "prestige_pkce";
export const STATE_COOKIE = "prestige_oauth_state";

const ISSUER = () => required("KEYCLOAK_ISSUER");
const CLIENT_ID = () => process.env.OIDC_CLIENT_ID ?? "prestige-web";
const REDIRECT_URI = () =>
  process.env.OIDC_REDIRECT_URI ?? "http://localhost:3001/api/auth/callback";
const POST_LOGOUT = () =>
  process.env.OIDC_POST_LOGOUT_REDIRECT ?? "http://localhost:3001/login";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(required("SESSION_SECRET"));
}

// ---------- PKCE ----------

export function newPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function newState() {
  return randomBytes(16).toString("base64url");
}

// ---------- URLs de Keycloak ----------

export function authorizeUrl(challenge: string, state: string, maxAge?: number): string {
  const u = new URL(`${ISSUER()}/protocol/openid-connect/auth`);
  u.searchParams.set("client_id", CLIENT_ID());
  u.searchParams.set("redirect_uri", REDIRECT_URI());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid profile email");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  // A-11 — step-up: fuerza a Keycloak a reautenticar si la sesión es más vieja
  // que `maxAge` segundos (refresca `auth_time`).
  if (maxAge && maxAge > 0) u.searchParams.set("max_age", String(maxAge));
  return u.toString();
}

export function endSessionUrl(idToken?: string): string {
  const u = new URL(`${ISSUER()}/protocol/openid-connect/logout`);
  u.searchParams.set("post_logout_redirect_uri", POST_LOGOUT());
  u.searchParams.set("client_id", CLIENT_ID());
  if (idToken) u.searchParams.set("id_token_hint", idToken);
  return u.toString();
}

// ---------- Token endpoint ----------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID(), ...body }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Keycloak token endpoint ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(code: string, verifier: string) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI(),
    code_verifier: verifier,
  });
}

export function refresh(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

// ---------- Sesión (cookie firmada) ----------

export interface Session {
  sub: string;
  actorId: string; // preferred_username
  name?: string;
  email?: string;
  roles: string[];
  tenantId: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accessExpiresAt: number; // epoch ms
}

interface AccessClaims {
  sub?: string;
  preferred_username?: string;
  name?: string;
  email?: string;
  tenant?: string;
  realm_access?: { roles?: string[] };
}

/** Decodifica (sin verificar firma — ya lo hará el BFF) el payload de un JWT. */
function decodeJwt<T>(token: string): T {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("JWT malformado");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
}

export function sessionFromTokens(t: TokenResponse): Session {
  const c = decodeJwt<AccessClaims>(t.access_token);
  return {
    sub: c.sub ?? "",
    actorId: c.preferred_username ?? c.sub ?? "",
    name: c.name,
    email: c.email,
    roles: c.realm_access?.roles ?? [],
    tenantId: c.tenant ?? "seguridata",
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    idToken: t.id_token,
    accessExpiresAt: Date.now() + (t.expires_in - 30) * 1000,
  };
}

/**
 * Con Redis (recomendado): la cookie sólo lleva `{ sid }` firmado y el `Session`
 * completo (tokens incluidos) vive en Redis — evita el límite de 4 KB de cookie.
 * Sin `REDIS_URL`: se firma el `Session` entero en la cookie (modo degradado).
 */
export async function sealSession(session: Session): Promise<string> {
  if (sessionStoreEnabled()) {
    const sid = randomBytes(18).toString("base64url");
    await putSession(sid, session);
    return new SignJWT({ sid })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(secretKey());
  }
  return new SignJWT(session as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secretKey());
}

export async function unsealSession(value: string | undefined): Promise<Session | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtVerify(value, secretKey());
    if (typeof (payload as { sid?: string }).sid === "string") {
      return readSession((payload as { sid: string }).sid);
    }
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

async function currentSid(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secretKey());
    return (payload as { sid?: string }).sid ?? null;
  } catch {
    return null;
  }
}

export async function writeSessionCookie(session: Session) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await sealSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 3600,
  });
}

export async function clearSessionCookie() {
  const sid = await currentSid();
  if (sid) await dropSession(sid);
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * Devuelve la sesión vigente, refrescando el access token si está por vencer.
 * Persiste la cookie renovada. `null` si no hay sesión o el refresh falló.
 */
export async function getValidSession(): Promise<Session | null> {
  const jar = await cookies();
  const session = await unsealSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  if (Date.now() < session.accessExpiresAt) return session;
  if (!session.refreshToken) return null;
  try {
    const renewed = sessionFromTokens(await refresh(session.refreshToken));
    await writeSessionCookie(renewed);
    return renewed;
  } catch {
    await clearSessionCookie();
    return null;
  }
}
