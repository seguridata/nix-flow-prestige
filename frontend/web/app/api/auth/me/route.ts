import { NextResponse } from "next/server";
import { getValidSession } from "@/libs/auth";

export const dynamic = "force-dynamic";

/** Identidad del usuario para el cliente. No expone tokens. */
export async function GET() {
  const s = await getValidSession();
  if (!s) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({
    authenticated: true,
    actorId: s.actorId,
    name: s.name ?? s.actorId,
    email: s.email ?? null,
    roles: s.roles,
    tenantId: s.tenantId,
  });
}
