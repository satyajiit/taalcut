// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineConfig } from 'vitest/config';

// Unit tests for the pure parts of main (security config, app://, theme
// store, supervisor, updater, power state) and the packaging config. Code
// that needs a running Electron is covered by the Playwright launch tests in
// e2e/ instead.
export default defineConfig({
  // The constants tsdown bakes into the bundles (packaging/build-settings.ts), as in a release build.
  define: {
    __TAALCUT_FLAVOUR__: '"release"',
    __TAALCUT_UPDATE_FEED__: '""',
    __TAALCUT_UPDATE_CHANNEL__: '""',
    __TAALCUT_CRASH_DSN__: '""',
    __TAALCUT_TELEMETRY_URL__: '""',
    __TAALCUT_HUB_INDEX_URL__: '""',
    __TAALCUT_HUB_WORKER_URL__: '""',
    __TAALCUT_TEST_UPDATE_FAULT__: '""',
    __TAALCUT_MAC_HELPER_PIN__: '""',
  },
  test: {
    include: ['test/**/*.test.ts'],
    // FFmpeg's check, once per run before the workers start; suites read it (test/helpers/test-ffmpeg.ts).
    globalSetup: ['test/helpers/ffmpeg-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'packaging/**/*.ts'],
    },
  },
});
