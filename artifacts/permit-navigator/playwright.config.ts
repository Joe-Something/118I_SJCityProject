import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/repl/tools/bin/chromium' },
  },
  webServer: {
    command: 'env -u REPL_ID PORT=4178 BASE_PATH=/ pnpm exec vite --config vite.config.ts --host 127.0.0.1',
    url: 'http://127.0.0.1:4178/test/harness.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});