// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pinned chrome-headless-shell for integration tests: TAALCUT_HEADLESS_SHELL,
 * else packages/render/.cache (pnpm --filter @taalcut/render fetch:shell), else
 * HyperFrames' own download cache. Without it the suites that capture skip
 * with a message.
 */
import { join } from 'node:path';
import { resolveHeadlessShell } from '../../src/engine/headless-shell';

export interface TestShell {
  readonly path?: string;
  readonly skipReason: string;
}

export function findTestShell(suite: string): TestShell {
  const resolved = resolveHeadlessShell({
    ...(process.env.TAALCUT_HEADLESS_SHELL ? { explicit: process.env.TAALCUT_HEADLESS_SHELL } : {}),
    development: true,
    packageDir: join(import.meta.dirname, '..', '..'),
  });
  if (resolved.ok) return { path: resolved.value, skipReason: '' };
  const skipReason = `${suite}: skipped, no chrome-headless-shell (run pnpm --filter @taalcut/render fetch:shell).`;
  console.warn(skipReason);
  return { skipReason };
}
