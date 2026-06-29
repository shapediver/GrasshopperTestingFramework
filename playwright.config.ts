import {defineConfig, devices} from "@playwright/test";

export default defineConfig({
  testDir: "./tests/specs",
  tsconfig: "./tests/tsconfig.json",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 3 : 2,
  reporter: [["html", {open: "never"}], ["list"]],
  timeout: 120_000,
  snapshotDir: "./tests/snapshots",
  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  use: {
    baseURL: undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    viewport: {width: 1280, height: 800},
  },
  projects: [
    {
      name: "chromium",
      use: {...devices["Desktop Chrome"]},
    },
  ],
});
