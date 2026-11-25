const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "tests",
  workers: 1,
  timeout: 120000,
  use: {
    actionTimeout: 10000,
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    headless: true,
    baseURL: "http://127.0.0.1:3019",
  },
  reporter: "list",
});
