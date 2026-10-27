import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    css: true,
    // Las pruebas de paginación pintan más de 200 filas: ~1 s en local y 5-7 s en el runner compartido de CI,
    // que con el límite por defecto (5 s) fallaba de forma intermitente sin ser un error del código.
    testTimeout: 20_000,
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e"],
  },
  resolve: {
    alias: {
      "@": dirname,
    },
  },
});
