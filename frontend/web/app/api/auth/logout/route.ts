import { NextResponse } from "next/server";
import { clearSessionCookie, endSessionUrl, getValidSession } from "@/libs/auth";

export const dynamic = "force-dynamic";

async function handle() {
  const session = await getValidSession();
  await clearSessionCookie();
  return NextResponse.redirect(endSessionUrl(session?.idToken));
}

export const GET = handle;
export const POST = handle;
