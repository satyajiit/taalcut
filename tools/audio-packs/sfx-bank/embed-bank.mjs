#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bank's CLAP audio embeddings for `sfx.searchSounds` (EAR1-D1 step 3), made with @taalcut/audio's own
 * TypeScript runner: this writes the job (the catalogue's items in order, each with its first take's raw PCM) and
 * runs packages/audio/src/sfx/bank-embed-cli.ts with tsx (tools import no package's internals). The next
 * `build-sfx-bank.mjs` run ships `<work>/embeddings-<dtype>.f32` and `embeddings.json`.
 *
 *   node tools/audio-packs/sfx-bank/embed-bank.mjs [--work <dir>] [--models <dir>] [--dtype int8,fp16]
 *
 * --models is the folder of unpacked listen builds (tools/components/listen/README.md; default
 * ~/.cache/taalcut-ear1/models). The CLI runs on ONNX Runtime's CPU provider, so two runs write the same bytes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_WORK, PAD_MS, SFX_BANK_VERSION } from './build-sfx-bank.mjs';
import { bankCatalogue } from './catalogue.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');

const { values } = parseArgs({
  options: {
    work: { type: 'string' },
    models: { type: 'string' },
    dtype: { type: 'string', default: 'int8,fp16' },
  },
});
const work = resolve(values.work ?? DEFAULT_WORK);
const render = JSON.parse(readFileSync(join(work, 'render.json'), 'utf8'));
const { catalogue } = bankCatalogue(render, { packVersion: SFX_BANK_VERSION, padMs: PAD_MS });
const job = join(work, 'embed-job.json');
const items = catalogue.items.map((item) => {
  const take = item.takes[0];
  const raw = join(work, 'raw', `${take.file.replace(/\.flac$/, '')}.s${take.bits}`);
  return { id: item.id, raw, bits: take.bits, channels: take.channels };
});
writeFileSync(job, `${JSON.stringify({ items }, null, 1)}\n`);
const run = spawnSync(
  join(REPO, 'node_modules', '.bin', 'tsx'),
  [
    join(REPO, 'packages', 'audio', 'src', 'sfx', 'bank-embed-cli.ts'),
    '--job',
    job,
    '--models',
    resolve(values.models ?? join(homedir(), '.cache', 'taalcut-ear1', 'models')),
    '--out',
    work,
    '--dtype',
    values.dtype,
  ],
  { cwd: join(REPO, 'packages', 'audio'), stdio: 'inherit' },
);
process.exit(run.status ?? 1);
