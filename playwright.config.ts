import { defineConfig } from "@playwright/test";

const DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5434/smart_email?schema=public";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  outputDir: "output/playwright/test-results",
  reporter: [["list"], ["html", { outputFolder: "output/playwright/html-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  webServer: [
    {
      command:
        "PORT=4100 HOST=127.0.0.1 DATABASE_URL=" +
        DATABASE_URL +
        " DASHBOARD_URL=http://127.0.0.1:3100 API_BASE_URL=http://127.0.0.1:4100 pnpm --filter @smart-email/api-server exec tsx src/index.ts",
      port: 4100,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command:
        "PORT=3100 HOST=127.0.0.1 DATABASE_URL=" +
        DATABASE_URL +
        " NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4100 NEXT_DIST_DIR=.next-e2e pnpm --filter @smart-email/dashboard-web exec next dev -p 3100 -H 127.0.0.1",
      port: 3100,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
