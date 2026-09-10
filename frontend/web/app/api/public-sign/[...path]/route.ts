import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BFF_URL = process.env.BFF_URL ?? "http://localhost:3000";

const STRIP = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
  "cookie",
  "authorization",
  // El cliente no debe poder falsear su IP (bypass del throttler / prueba de
  // consentimiento) a través de este proxy sin sesión.
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "forwarded",
]);

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * M13 — proxy SIN sesión hacia `/public/links/*` del BFF (portal del firmante
 * externo). La autorización es el token de un solo uso en la ruta, no Keycloak.
 */
async function handler(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const segments = path ?? [];
  if (segments.length === 0 || segments.length > 3 || !segments.every((s) => SEGMENT.test(s))) {
    return NextResponse.json({ message: "Ruta no válida" }, { status: 400 });
  }
  const target = `${BFF_URL}/public/links/${segments.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!STRIP.has(k.toLowerCase())) headers.set(k, v);
  });

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: "manual",
    cache: "no-store",
  });

  const resHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    if (k.toLowerCase() !== "content-encoding" && k.toLowerCase() !== "transfer-encoding") {
      resHeaders.set(k, v);
    }
  });
  return new NextResponse(upstream.body, { status: upstream.status, headers: resHeaders });
}

export const GET = handler;
export const POST = handler;
