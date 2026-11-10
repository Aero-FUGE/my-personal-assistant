import { defineConfig, devices } from "@playwright/test";
const baseURL = `http://127.0.0.1:4173${process.env.PLAYWRIGHT_BASE_PATH || ""}/`;
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL,
    ...devices["iPhone 13"],

    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "npm run preview -- --host 127.0.0.1",
    env: { VITE_BASE_PATH: `${process.env.PLAYWRIGHT_BASE_PATH || ""}/` },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
