// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineConfig } from 'vitest/config';

// Integration tests make their fixture media with ffmpeg in beforeAll, so hooks get more time.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // FFmpeg's check, once per run before the workers start; suites read it (test/helpers/binaries.ts).
    globalSetup: ['test/helpers/ffmpeg-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
