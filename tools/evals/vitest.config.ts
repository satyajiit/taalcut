// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineConfig } from 'vitest/config';

// No coverage gate here. The 80% gates stay on core, agent, and tools.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Vitest's own limits. The tests and hooks that start FFmpeg say so (test/starts-processes.ts); the suites that
    // run whole pipelines have their own.
    // FFmpeg's check, once per run before the workers start; the adapter suites read it.
    globalSetup: ['test/ffmpeg-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
