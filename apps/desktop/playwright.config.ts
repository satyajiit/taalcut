// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Playwright for Electron. No browser download: tests drive the Electron
 * binary (project "app", the unpackaged build in out/) or attach over CDP to
 * the packaged app (project "packaged", release/mac-arm64/Taalcut.app).
 *
 *   pnpm --filter @taalcut/desktop e2e            build, then the "app" project (with durability),
 *                                                 then "gate", "make" and "window" (the real renderer)
 *   pnpm --filter @taalcut/desktop e2e:packaged   build, package (dir), then "packaged"
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 60_000,
  // One app at a time, whatever the machine or heavy.sh's share (TAALCUT_TEST_CORES): already the least.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  projects: [
    // durability*.e2e.ts kill and relaunch the unpackaged build too (gate criterion 5).
    { name: 'app', testMatch: ['app*.e2e.ts', 'durability*.e2e.ts', 'feedback.e2e.ts'] },
    // P1-I1: the gate demo in the test build, on the recorded model session.
    { name: 'gate', testMatch: 'gate*.e2e.ts' },
    // P2-M13: the make flow's journeys in the test build, on the recorded make-flow session; and an external
    // agent's export approved in that window (security review SB-36).
    { name: 'make', testMatch: ['make-flow*.e2e.ts', 'mcp-journey.e2e.ts'] },
    // The window bar's controls on the real window: the test build with the real renderer, like gate.
    { name: 'window', testMatch: 'window*.e2e.ts' },
    // P2-L13: a generated library indexed in the real app with local models and no network, then searched;
    // and kill -9 of the jobs process mid-index (the test build with the real renderer, like gate).
    { name: 'indexing', testMatch: 'indexing*.e2e.ts' },
    { name: 'packaged', testMatch: 'packaged*.e2e.ts' },
    // P3-R1: cold start and the real preview's frame rate, measured; opt-in (e2e:perf), never in `e2e`.
    { name: 'perf', testMatch: 'perf-*.e2e.ts' },
    // UX3-AGT: the sign-in callback page in a headless Chromium against the real loopback server; no Electron.
    {
      name: 'callback',
      testMatch: 'signin-callback*.e2e.ts',
      use: { browserName: 'chromium', headless: true },
    },
  ],
});
