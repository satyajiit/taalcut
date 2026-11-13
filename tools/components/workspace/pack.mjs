#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds one of the workspace shell's toolchain components (AGT2 sbx) from its pins and prints a JSON summary whose
 * `archive` the hosting build's script recipe takes (hosting/plan/workspace.mjs).
 *
 *   [TAALCUT_MAC_IDENTITY="Developer ID Application: …"] \
 *   node tools/components/workspace/pack.mjs --component workspace-node|workspace-python|hyperframes-cli \
 *        --out <dir> [--platform darwin-arm64]
 *
 * Without an identity the build is a development one: Mach-O files keep their ad hoc signatures, and only a local
 * release (TAALCUT_DEV_COMPONENTS) installs it. workspace-node is never re-signed (the Node.js Foundation's).
 */
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_CACHE } from '../hosting/pinned.mjs';
import { packCli } from './pack-cli.mjs';
import { packNode } from './pack-node.mjs';
import { packPython } from './pack-python.mjs';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

export const PACKERS = {
  'workspace-node': packNode,
  'workspace-python': packPython,
  'hyperframes-cli': packCli,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      component: { type: 'string' },
      out: { type: 'string' },
      platform: { type: 'string', default: 'darwin-arm64' },
    },
  });
  const packer = PACKERS[values.component ?? ''];
  if (!packer || !values.out) {
    console.error(`usage: pack.mjs --component ${Object.keys(PACKERS).join('|')} --out <dir> [--platform p]`);
    process.exit(2);
  }
  const log = (line) => console.error(line);
  try {
    const summary = await packer({
      out: resolve(values.out),
      platform: values.platform,
      identity: process.env.TAALCUT_MAC_IDENTITY || undefined,
      pinOptions: { cacheDir: process.env.TAALCUT_COMPONENTS_CACHE || DEFAULT_CACHE, log },
      log,
    });
    console.log(JSON.stringify({ ...summary, archive: relative(REPO, summary.archive) }, null, 2));
  } catch (error) {
    console.error(`pack ${values.component}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
