#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F5 (D23): the text embeddings the CLAP audio components ship, one bank per text dtype, built with the
 * TypeScript runner (packages/audio/src/listen/calibrate/text-bank-cli.ts, run here with tsx: tools import no
 * package's internals) on the unpacked text builds. See README.md beside this file, "Text embeddings".
 *
 *   node tools/components/listen/build-text-embeddings.mjs [--models <dir>] [--out <dir>] [--check]
 *
 * --models  the unpacked builds (default ~/.cache/taalcut-ear1/models, pack-listen-models.mjs's)
 * --out     default tools/components/listen/text-embeddings (committed: the archives pack these exact bytes)
 * --check   rebuild in memory and compare with what is there (cosine ≥ 0.9999 per row) instead of writing
 */
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');

const { values } = parseArgs({
  options: { models: { type: 'string' }, out: { type: 'string' }, check: { type: 'boolean' } },
});
const args = [
  join(REPO, 'packages', 'audio', 'src', 'listen', 'calibrate', 'text-bank-cli.ts'),
  '--models',
  resolve(values.models ?? join(homedir(), '.cache', 'taalcut-ear1', 'models')),
  '--out',
  resolve(values.out ?? join(HERE, 'text-embeddings')),
  '--prettier',
  join(REPO, 'node_modules', '.bin', 'prettier'),
  ...(values.check ? ['--check'] : []),
];
const run = spawnSync(join(REPO, 'node_modules', '.bin', 'tsx'), args, {
  cwd: join(REPO, 'packages', 'audio'),
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
