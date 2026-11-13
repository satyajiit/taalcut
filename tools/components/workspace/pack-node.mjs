// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * workspace-node: nodejs.org's Node 24 for the platform, reduced to its executable and its licence (NODE_KEEP),
 * unchanged. The executable keeps the Node.js Foundation's Developer ID signature and notarisation, so nothing is
 * re-signed; the build checks that signature against the pinned team.
 */
import { copyFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { extract } from '../hosting/archive.mjs';
import { pinned } from '../hosting/pinned.mjs';
import { finish, onlyDir, run } from './build-common.mjs';
import { NODE, NODE_KEEP } from './pins.mjs';

export const nodeArchiveName = (platform) => `node-v${NODE.version}-${platform}.tar.zst`;

export async function packNode({ out, platform, pinOptions, log }) {
  const pin = NODE[platform];
  if (!pin) throw new Error(`no Node pin for ${platform}`);
  await mkdir(out, { recursive: true });
  const work = await realpath(await mkdtemp(join(out, '.work-node-')));
  try {
    await extract(await pinned(pin, pinOptions), 'tar.gz', join(work, 'upstream'));
    const upstream = await onlyDir(join(work, 'upstream'));
    const root = join(work, 'component');
    for (const path of NODE_KEEP) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await copyFile(join(upstream, path), join(root, path));
    }
    const version = (await run(log, join(root, 'bin', 'node'), ['--version'])).trim();
    if (version !== `v${NODE.version}`) throw new Error(`node --version says ${version}`);
    return await finish({
      root,
      out: join(out, nodeArchiveName(platform)),
      team: platform.startsWith('darwin') ? NODE.team : undefined,
      platform,
      log,
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
