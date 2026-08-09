import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", testMatch: "**/*.pw.ts", timeout: 30_000, fullyParallel: false, workers: 1, reporter: "line", use: { trace: "retain-on-failure" } });
