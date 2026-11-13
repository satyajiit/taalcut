// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'bench/**/*.test.ts'],
    // FFmpeg's check, once per run before any file starts; the 1,000-item import reads it.
    globalSetup: ['test/ffmpeg-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // The 2 GiB loopback bench is opt-in (TAALCUT_TRANSFER_BENCH=1).
    fileParallelism: false,
  },
});
