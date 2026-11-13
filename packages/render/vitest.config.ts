// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { configDefaults, defineConfig } from 'vitest/config';

/** The real Content Credentials sidecar's tests: they need `taalcut-c2pa` built from native/c2pa-sidecar. */
const SIDECAR_TESTS = ['test/credentials/sign.int.test.ts', 'test/credentials/sign-codecs.int.test.ts'];
const FFMPEG_SETUP = 'test/support/ffmpeg-setup.ts';

// Integration suites render real compositions and make fixtures with FFmpeg in beforeAll, so hooks and
// tests get more time than a unit test. Renders share the GPU and the pinned shell: one file at a time.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 240_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'render',
          include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...SIDECAR_TESTS],
          // FFmpeg's check, once per run before any file starts; suites read it (test/support/media.ts).
          globalSetup: [FFMPEG_SETUP],
          sequence: { groupOrder: 0 },
        },
      },
      {
        // Its global setup builds the sidecar first, only when the crate's inputs changed and only when a test
        // of this project runs, so no test hook compiles (build-sidecar.ts). After the renders, one at a time.
        extends: true,
        test: {
          name: 'credentials',
          include: SIDECAR_TESTS,
          globalSetup: [FFMPEG_SETUP, 'test/credentials/build-sidecar.ts'],
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
