// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Offline like the agent suite (P1-I3): the models are scripted, FFmpeg runs locally.
    setupFiles: ['test/offline.ts'],
    // FFmpeg's check, once per run before the workers start; the demo reads it (gate-demo.test.ts).
    globalSetup: ['test/ffmpeg-setup.ts'],
  },
});
