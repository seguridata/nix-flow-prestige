import { NextResponse } from "next/server";
import { clearSessionCookie, endSessionUrl, getValidSession, knownClient } from "@/libs/auth";

export const dynamic = "force-dynamic";

async function handle() {
  const session = await getValidSession();
  await clearSessionCookie();
  return NextResponse.redirect(endSessionUrl(session?.idToken, knownClient(session?.clientId)));
}

export const GET = handle;
export const POST = handle;
