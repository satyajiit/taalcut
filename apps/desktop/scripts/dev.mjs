// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * pnpm --filter @taalcut/desktop dev
 *
 * Builds main, preload and utility entries in watch mode and restarts
 * Electron once every rebuild has finished (scripts/dev-session.mjs says
 * when). The renderer comes from out/renderer (the renderer build, or the
 * placeholder; a build older than its sources is built again first,
 * renderer-freshness.mjs), or from the renderer's Vite dev server when
 * TAALCUT_RENDERER_URL is set:
 *
 *   TAALCUT_RENDERER_URL=http://localhost:5173 pnpm --filter @taalcut/desktop dev
 *
 * Quitting the app, or Ctrl-C here, ends the dev session. An app that fails
 * to start or crashes doesn't: the next rebuild starts it again. The watchers
 * ignore node_modules (dev-session.mjs, IGNORED_BY_WATCH): after a
 * `pnpm install`, start the session again.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';
import { createDevSession, DEV_OUTPUTS, IGNORED_BY_WATCH, rebuildTracker } from './dev-session.mjs';
import { staleRenderer } from './renderer-freshness.mjs';
import { sandboxHint } from './linux/sandbox-check.mjs';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(desktopDir, 'out');
const electronPath = createRequire(import.meta.url)('electron');

// Ubuntu 23.10+: without the development AppArmor profile Electron's sandbox can't start (scripts/linux/).
const hint = sandboxHint();
if (hint) {
  console.error(hint);
  process.exit(1);
}

const session = createDevSession({
  ready: () => DEV_OUTPUTS.every((file) => existsSync(join(outDir, file))),
  launch: () => spawn(electronPath, ['.'], { cwd: desktopDir, stdio: 'inherit', env: process.env }),
  exit: (code) => process.exit(code),
  log: (message) => console.warn(`[dev] ${message}`),
});
process.on('SIGINT', () => session.stop(130));
process.on('SIGTERM', () => session.stop(143));

// The window comes from the renderer's build: one older than its sources (a pull, a merge) is built again first.
const stale = process.env.TAALCUT_RENDERER_URL
  ? null
  : staleRenderer({ root: join(desktopDir, '..', '..'), dist: join(desktopDir, '..', 'renderer', 'dist') });
if (stale) {
  console.warn(`[dev] the renderer's build is older than ${stale}: building it first`);
  const built = spawnSync('pnpm', ['--filter', '@taalcut/renderer', 'build'], { stdio: 'inherit' });
  if (built.status !== 0) {
    console.error('[dev] the renderer build failed; the window would be out of date, so dev stops here');
    process.exit(built.status ?? 1);
  }
}
await import('./copy-renderer.mjs');
await build({
  config: join(desktopDir, 'tsdown.config.ts'),
  // The config imports packaging/*.ts without extensions, which Node's own loader can't resolve.
  configLoader: 'tsx',
  cwd: desktopDir,
  watch: true,
  ignoreWatch: [IGNORED_BY_WATCH],
  plugins: [rebuildTracker(session)],
  onSuccess: (config) => session.built(config.name ?? config.outDir),
});
