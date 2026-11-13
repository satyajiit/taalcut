#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the `sfx-bank` component (EAR1-D1, D22): earshot's SFX bank rendered into takes, measured, audited,
 * encoded as FLAC (16-bit, 24 where 16 would change the audit) between 50 ms of silence, with `catalogue.json`
 * (the shape packages/audio/src/sfx/bank-catalogue.ts reads), CLAP embeddings, earshot's MIT licence, the credits
 * of the CC0 recordings the fitted sounds were measured from, and a NOTICE, then packed as a reproducible tar.zst
 * (../pack-archive.mjs). Prints sha256, size and extractedSize for
 * tools/components/manifest.sfx-bank.provisional.json. README.md beside this file.
 *
 *   node tools/audio-packs/sfx-bank/build-sfx-bank.mjs [--render] [--embed] [--takes 2] [--work <dir>]
 *        [--out <dir>] [--ffmpeg <path>] [--no-archive]
 *
 * `--render` first runs render_bank.py in upstream earshot's venv (build time only; Python never runs in the app):
 * every sound's takes and the four presets' takes into <work> (default ~/.cache/taalcut-ear1/sfx-bank-work).
 * `--embed` then runs embed-bank.mjs (the package's CLAP runner on the CPU, the unpacked listen builds in
 * ~/.cache/taalcut-ear1/models). Then this script: catalogue (refusing any item without a licence and a source),
 * FLAC with the bundled FFmpeg's bit-exact flags, the archive. Default output: packages/audio/.cache/packs/sfx-bank/
 * and packages/audio/.cache/packs/sfx-bank-<version>.tar.zst (gitignored). Without embeddings in <work> the
 * catalogue's `embeddings` is empty.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { writeArchive } from '../pack-archive.mjs';
import { bankCatalogue } from './catalogue.mjs';
import { bankNotice } from './notice.mjs';

/**
 * earshot 0.4.0 at ff41f07, Taalcut's build 2 of it (build 1 labelled the fitted sounds CC0; they are MIT renders,
 * D22). Bump the last part when the build changes its bytes.
 */
export const SFX_BANK_VERSION = '0.4.0-ff41f07.2';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const EARSHOT = join(REPO, 'third_party', 'earshot');
export const DEFAULT_WORK = join(homedir(), '.cache', 'taalcut-ear1', 'sfx-bank-work');
const VENV_PYTHON = join(homedir(), '.cache', 'taalcut-ear1', 'venv', 'bin', 'python');

/**
 * Digital silence before and after every take, ms. A hit's clip starts on the first frame at or after its start
 * and skips into its file by the difference, and ends on the last whole frame (audio's hits-command): without the
 * pad, a sound whose apex lies within a frame of either end (a click's attack, a riser that stops on its loudest
 * sample) would lose it. 50 ms covers a frame at 20 fps and up, and is a whole number of ms, so earshot's 1 ms grid
 * stays where it was.
 */
export const PAD_MS = 50;

function ffmpeg(binary, args) {
  execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { maxBuffer: 1 << 26 });
}

/** One take's raw PCM (render_bank.py) between PAD_MS of silence → FLAC, no metadata, bit-exact. */
function encodeTake(binary, raw, take, path) {
  const pad = Buffer.alloc((PAD_MS * 48 * take.channels * take.bits) / 8);
  // Through a file, not a pipe: a sync pipe into FFmpeg can stall on a loaded machine.
  const padded = `${path}.pcm`;
  writeFileSync(padded, Buffer.concat([pad, readFileSync(raw), pad]));
  ffmpeg(binary, [
    '-y',
    '-f',
    take.bits === 24 ? 's24le' : 's16le',
    '-ar',
    '48000',
    '-ac',
    String(take.channels),
    '-i',
    padded,
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-c:a',
    'flac',
    '-compression_level',
    '8',
    path,
  ]);
  rmSync(padded);
}

/** CLAP embeddings written by the TypeScript runner, if any: `[{ model, dtype, file, dims, ids }]`. */
function embeddingsOf(work, items) {
  const path = join(work, 'embeddings.json');
  if (!existsSync(path)) return [];
  const sets = JSON.parse(readFileSync(path, 'utf8'));
  const ids = items.map((item) => item.id);
  return sets.map((set) => {
    if (JSON.stringify(set.ids) !== JSON.stringify(ids))
      throw new Error(`${set.file}: its rows are not the catalogue's items (re-run the embedding step)`);
    return { model: set.model, dtype: set.dtype, file: set.file, dims: set.dims, rows: ids.length };
  });
}

/** Renders nothing: catalogues and encodes `<work>`'s takes into `out` (emptied first). */
export function buildSfxBank({ work = DEFAULT_WORK, out, ffmpeg: binary, packVersion = SFX_BANK_VERSION }) {
  const render = JSON.parse(readFileSync(join(work, 'render.json'), 'utf8'));
  const { catalogue, files } = bankCatalogue(render, { packVersion, padMs: PAD_MS });
  catalogue.embeddings = embeddingsOf(work, catalogue.items);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const item of catalogue.items)
    for (const take of item.takes) {
      const path = join(out, take.file);
      if (!existsSync(path))
        encodeTake(
          binary,
          join(work, 'raw', `${take.file.replace(/\.flac$/, '')}.s${take.bits}`),
          take,
          path,
        );
    }
  for (const set of catalogue.embeddings) copyFileSync(join(work, set.file), join(out, set.file));
  writeFileSync(join(out, 'catalogue.json'), `${JSON.stringify(catalogue, null, 1)}\n`);
  copyFileSync(join(EARSHOT, 'LICENSE'), join(out, 'LICENSE-earshot.txt'));
  copyFileSync(join(EARSHOT, 'docs', 'CREDITS_FIT.md'), join(out, 'CREDITS_FIT.md'));
  writeFileSync(join(out, 'NOTICE.txt'), bankNotice(catalogue));
  const extra = ['catalogue.json', 'LICENSE-earshot.txt', 'CREDITS_FIT.md', 'NOTICE.txt'];
  return { catalogue, files: [...extra, ...catalogue.embeddings.map((s) => s.file), ...files] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      render: { type: 'boolean' },
      embed: { type: 'boolean' },
      takes: { type: 'string', default: '2' },
      work: { type: 'string' },
      out: { type: 'string' },
      ffmpeg: { type: 'string' },
      'no-archive': { type: 'boolean' },
    },
  });
  const work = resolve(values.work ?? DEFAULT_WORK);
  if (values.render)
    execFileSync(
      process.env.TAALCUT_EARSHOT_PYTHON ?? VENV_PYTHON,
      ['-I', join(HERE, 'render_bank.py'), '--work', work, '--takes', values.takes],
      { stdio: 'inherit' },
    );
  if (values.embed)
    execFileSync(process.execPath, [join(HERE, 'embed-bank.mjs'), '--work', work], { stdio: 'inherit' });
  const packs = join(REPO, 'packages', 'audio', '.cache', 'packs');
  const out = resolve(values.out ?? join(packs, 'sfx-bank'));
  const binary =
    values.ffmpeg ?? process.env.TAALCUT_FFMPEG ?? join(REPO, 'tools', 'ffmpeg', 'dist', 'ffmpeg');
  const { catalogue, files } = buildSfxBank({ work, out, ffmpeg: binary });
  const takes = catalogue.items.reduce((n, item) => n + item.takes.length, 0);
  const summary = {
    version: SFX_BANK_VERSION,
    out,
    sounds: catalogue.items.length,
    takes,
    withheld: catalogue.withheld.map((w) => `${w.upstreamId} (${w.warnings.join(', ')})`),
  };
  if (!values['no-archive']) {
    const archive = join(dirname(out), `sfx-bank-${SFX_BANK_VERSION}.tar.zst`);
    Object.assign(summary, { archive, ...writeArchive(out, files, archive) });
  }
  console.log(JSON.stringify(summary, null, 2));
}
