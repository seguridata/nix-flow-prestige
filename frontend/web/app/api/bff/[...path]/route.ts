import { type NextRequest, NextResponse } from "next/server";
import { getValidSession } from "@/libs/auth";
import { filterRequestHeaders } from "@/libs/proxy-headers";

export const dynamic = "force-dynamic";

const BFF_URL = process.env.BFF_URL ?? "http://localhost:3000";

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await getValidSession();
  if (!session) {
    return NextResponse.json({ message: "No autenticado" }, { status: 401 });
  }

  const { path } = await ctx.params;
  const target = `${BFF_URL}/${(path ?? []).join("/")}${req.nextUrl.search}`;

  // Lista blanca de entrada: nada de x-forwarded-*, x-real-ip, x-user-*, cookies, etc.
  const headers = filterRequestHeaders(req.headers);
  // El body se reenvía ya leído; fetch recalcula la longitud.
  headers.delete("content-length");
  headers.set("authorization", `Bearer ${session.accessToken}`);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (err) {
    // El BFF no está escuchando todavía (arranque en frío) o se cayó.
    // Devolvemos 502 con un mensaje claro en vez de un 500 opaco.
    const cause =
      err instanceof Error && "cause" in err ? String((err as { cause?: unknown }).cause) : String(err);
    console.error(`[bff-proxy] ${req.method} ${target} → sin respuesta: ${cause}`);
    return NextResponse.json(
      { message: "El BFF no está disponible. ¿Terminó de arrancar en :3000?", target },
      { status: 502 },
    );
  }

  const resHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    if (k.toLowerCase() !== "content-encoding" && k.toLowerCase() !== "transfer-encoding") {
      resHeaders.set(k, v);
    }
  });
  resHeaders.set("cache-control", "private, no-store");
  return new NextResponse(upstream.body, { status: upstream.status, headers: resHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
