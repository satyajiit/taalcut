// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether apps/renderer/dist is older than what it is built from, for `pnpm dev` (dev.mjs). The session copies
 * that build as it is (copy-renderer.mjs), so after a pull or a merge it showed the window as it was before them
 * (UX3: the old Templates pages after the redesign merged). A checkout or merge writes every file it changes, so a
 * source newer than the build's index.html means the build is behind.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** What the renderer's build reads, from the repository root: its own sources, its workspace packages, the tokens. */
export const RENDERER_INPUTS = [
  'apps/renderer/src',
  'apps/renderer/public',
  'apps/renderer/index.html',
  'apps/renderer/vite.config.ts',
  'packages/ui/src',
  'packages/core/src',
  'design/tokens',
  'third_party/page-mascot',
  'third_party/react-bits',
];

const SKIPPED = new Set(['node_modules', 'dist', '.turbo', '.vitest-cache']);

/** The first file under `path` changed after `since` (ms), or null. */
function newerIn(path, since) {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs > since ? path : null;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const found = newerIn(join(path, entry.name), since);
    if (found) return found;
  }
  return null;
}

/**
 * Why the renderer build in `dist` is behind its inputs under `root`, or null when it isn't. With no build at all
 * it says nothing: copy-renderer.mjs shows the placeholder then, as before.
 */
export function staleRenderer({ root, dist, inputs = RENDERER_INPUTS }) {
  const index = join(dist, 'index.html');
  if (!existsSync(index)) return null;
  const built = statSync(index).mtimeMs;
  for (const input of inputs) {
    const found = newerIn(join(root, input), built);
    if (found) return relative(root, found);
  }
  return null;
}
