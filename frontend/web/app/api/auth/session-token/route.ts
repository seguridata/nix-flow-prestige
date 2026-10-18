import { NextResponse } from "next/server";
import { getValidSession } from "@/libs/auth";

export const dynamic = "force-dynamic";

/**
 * Access token de corta vida para el handshake de Socket.IO (el WS no puede
 * pasar por el proxy de route handlers). Solo lo pide el cliente justo antes
 * de conectar; el token vive ~15 min y solo autentica presencia.
 */
export async function GET() {
  const s = await getValidSession();
  if (!s) return NextResponse.json({ error: "no_session" }, { status: 401 });
  return NextResponse.json({ token: s.accessToken, expiresAt: s.accessExpiresAt });
}
