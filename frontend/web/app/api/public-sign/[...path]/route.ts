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
]);

/**
 * M13 — proxy SIN sesión hacia `/public/links/*` del BFF (portal del firmante
 * externo). La autorización es el token de un solo uso en la ruta, no Keycloak.
 */
async function handler(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = `${BFF_URL}/public/links/${(path ?? []).join("/")}${req.nextUrl.search}`;

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
