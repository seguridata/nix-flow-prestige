import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Proxy (antes `middleware`, renombrado en Next 16). Exige sesión en toda ruta
 * salvo `/login` y `/api/auth/*`. No refresca tokens aquí: solo comprueba que
 * la cookie de sesión tenga firma y vigencia válidas.
 */
const SESSION_COOKIE = "prestige_session";
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/",
  "/verificar",
  "/firmar",
  "/api/public-sign/",
];

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return false;
  try {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET ?? "");
    await jwtVerify(raw, secret);
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (await hasValidSession(req)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ message: "No autenticado" }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  login.searchParams.set("returnTo", pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // Excluye estáticos, imágenes y assets del árbol de proxy.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|icon.png).*)"],
};
