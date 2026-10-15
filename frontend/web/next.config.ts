import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(configDir, "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  outputFileTracingRoot: monorepoRoot,
  // La imagen de producción (frontend/web/Dockerfile) construye con NEXT_OUTPUT=standalone; en local `next start` sigue igual.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  turbopack: {
    root: monorepoRoot,
  },
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] },
      { source: "/firmar/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/verificar/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
