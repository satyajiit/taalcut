// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineConfig, devices } from '@playwright/test';
import { playwrightWorkers, testCores } from '../../scripts/test-budget/cores.ts';

// Parallel worktrees each need their own port: TAALCUT_E2E_PORT=4527 pnpm e2e.
const PORT = Number(process.env.TAALCUT_E2E_PORT ?? 4517);

/**
 * End-to-end checks against the production build served by `vite preview`,
 * which sends the desktop app's CSP. Chromium only: Electron is Chromium.
 * Output (screenshots, traces, report) goes to e2e-artifacts/, which git ignores.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-artifacts/test-results',
  fullyParallel: true,
  // Half the run's cores (each worker drives a Chromium of several processes): Playwright's own default on a
  // whole machine, and within heavy.sh's share when TAALCUT_TEST_CORES gives one (scripts/test-budget/cores.ts).
  workers: playwrightWorkers(testCores()),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: './e2e-artifacts/report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `pnpm run build && pnpm run preview --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
