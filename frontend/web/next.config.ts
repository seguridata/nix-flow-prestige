import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(configDir, "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
