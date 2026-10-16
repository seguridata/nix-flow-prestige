import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "prestige-product.live.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.PRESTIGE_E2E_BASE_URL ?? "http://localhost:3001",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
