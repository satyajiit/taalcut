// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { resolveHeadlessShell } from '@taalcut/render';

/**
 * Whether the pinned headless browser is on this machine, looked for where an unpackaged run looks
 * (src/utility/creation/browser.ts). A checkout or CI that hasn't fetched it (`pnpm --filter @taalcut/render
 * fetch:shell`) gets `false`, for the suite to skip and say so, as the FFmpeg suites do (test-ffmpeg.ts).
 */
export function hasTestHeadlessShell(suite: string): boolean {
  const found = resolveHeadlessShell({
    development: true,
    packageDir: dirname(dirname(createRequire(import.meta.url).resolve('@taalcut/render'))),
    ...(process.env.TAALCUT_HEADLESS_SHELL ? { explicit: process.env.TAALCUT_HEADLESS_SHELL } : {}),
  });
  if (!found.ok) {
    console.warn(
      `${suite}: skipped, no chrome-headless-shell (run pnpm --filter @taalcut/render fetch:shell).`,
    );
  }
  return found.ok;
}
