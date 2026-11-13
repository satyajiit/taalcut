// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Starts the download of everything a test manifest's tier lists in its own process, so a test can SIGKILL it in
 * the middle, the way a force-quit or a crash would, then "launch the app again" in the test's own process.
 *
 *   node --import tsx set-child.ts <components dir> <manifest.json>
 */
import { readFileSync } from 'node:fs';
import { ok, unwrap } from '@taalcut/core';
import { createComponentManager, createDownloadSet, parseManifest } from '../../src/index';

const [root, manifestPath] = process.argv.slice(2) as [string, string];
const manifest = unwrap(parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))));
const manager = createComponentManager({
  root,
  manifest,
  fetch: globalThis.fetch,
  statfs: async () => ({ bavail: 2 ** 40, bsize: 1 }),
  platform: 'darwin-arm64',
  // The test holds the server's responses; keep this process waiting until it is killed.
  download: { stallTimeoutMs: 120_000 },
});
const set = createDownloadSet({
  manager,
  manifest,
  root,
  machine: async () => ok({ tier: 'recommended' }),
  platform: 'darwin-arm64',
});
const started = await set.start();
process.stdout.write(`${JSON.stringify({ started: started.ok })}\n`);
