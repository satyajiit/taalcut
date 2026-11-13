// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against the exported site (`out/`), served as Firebase Hosting would: static files, trailing slashes.
 * SITE_PORT lets parallel worktrees each serve their own build (a reused server on a shared port would test another
 * worktree's site).
 */
const PORT = Number(process.env.SITE_PORT ?? 4173);

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec serve out -l ${PORT} --no-clipboard`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
