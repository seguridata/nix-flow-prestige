import { type NextRequest, NextResponse } from "next/server";
import { getValidSession } from "@/libs/auth";

export const dynamic = "force-dynamic";

const BFF_URL = process.env.BFF_URL ?? "http://localhost:3000";

// Cabeceras que no se reenvían tal cual (las gestiona fetch/host).
const STRIP = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
  "cookie",
]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await getValidSession();
  if (!session) {
    return NextResponse.json({ message: "No autenticado" }, { status: 401 });
  }

  const { path } = await ctx.params;
  const target = `${BFF_URL}/${(path ?? []).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!STRIP.has(k.toLowerCase())) headers.set(k, v);
  });
  headers.set("authorization", `Bearer ${session.accessToken}`);

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

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
