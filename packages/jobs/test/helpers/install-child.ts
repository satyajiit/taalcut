// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs one component install in its own process, so a test can SIGKILL it in
 * the middle of a download, the way a crash or a force-quit would.
 *
 *   node --import tsx install-child.ts <components dir> <manifest.json> <component id>
 */
import { readFileSync } from 'node:fs';
import { unwrap } from '@taalcut/core';
import { createComponentManager, parseManifest } from '../../src/index';

const [root, manifestPath, id] = process.argv.slice(2) as [string, string, string];
const manifest = unwrap(parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))));
const manager = createComponentManager({
  root,
  manifest,
  fetch: globalThis.fetch,
  // The test controls the disk and the stalls; keep this process waiting until it is killed.
  statfs: async () => ({ bavail: 2 ** 40, bsize: 1 }),
  download: { stallTimeoutMs: 120_000 },
});
const result = await manager.install(id);
process.stdout.write(`${JSON.stringify(result)}\n`);
