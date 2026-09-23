import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests, against a real server and a real database.
 *
 * Four decisions worth stating, because each was a trade rather than a default:
 *
 *  - **One worker.** These share the seeded database with the unit suite and
 *    with whatever is open in a browser. Parallel workers would race each other
 *    through the same rows, and a flaky E2E suite is worse than none — people
 *    stop believing the failures.
 *  - **They do not truncate anything.** The integration tests own that; these
 *    read the seed and clean up only what they create. A suite that wipes the
 *    developer's data to run is a suite nobody runs twice.
 *  - **`npm run dev`, not a production build.** The middleware and route
 *    handlers are what is under test; building first would double the feedback
 *    loop for no extra coverage. `reuseExistingServer` means a dev server
 *    already running is used as-is.
 *  - **No retries locally.** A test that passes on the second attempt is a test
 *    that will pass on the second attempt in CI too, and hide a real race.
 *
 * One thing to know before you run it twice: the suite signs in for real, and
 * the product limits sign-in to 8 attempts per 5 minutes per account and per
 * source. A single run stays inside that; two runs back to back do not, and the
 * second fails on a 429. That is the limiter working, not the suite breaking —
 * `auth.setup.ts` exists so the count is one sign-in plus whatever
 * `auth.spec.ts` needs to test sign-in itself, rather than one per test.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : [["list"]],
  // Generous: a cold dev server compiles each route on first visit, and a model
  // call on the drafting path can legitimately take most of a minute.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      // Sign-in itself, so it must start with no session.
      name: "unauthenticated",
      testMatch: /auth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /auth\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/owner.json" },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
