#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the `sfx-pack` component (packages/audio SPEC P3.6): every recipe in sfx-sounds.mjs rendered with the
 * bundled FFmpeg into a 48 kHz mono FLAC, measured, catalogued (`catalogue.json`, the shape of
 * packages/audio/src/sfx/pack-catalogue.ts), with the CC0 dedication as `LICENCE.txt`, then packed as a
 * reproducible tar.zst. Prints the archive's sha256, size and extractedSize for
 * tools/components/manifest.voice-music.provisional.json.
 *
 *   node tools/audio-packs/build-sfx-pack.mjs [--out <dir>] [--ffmpeg <path>] [--only <id,id>] [--no-archive]
 *
 * Default output: packages/audio/.cache/packs/sfx-pack/ and packages/audio/.cache/packs/sfx-pack-<version>.tar.zst
 * (gitignored; never commit the sounds). FLAC, not Opus: the shipped LGPL FFmpeg has no libopus, and its native
 * Opus encoder is experimental. Run it under the hardware-encoder lock with the other media work.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { writeArchive } from './pack-archive.mjs';
import { SFX_RECIPES } from './sfx-sounds.mjs';
import { measureFile, normalisedPcm16, renderGraph, writeFlac } from './sound-files.mjs';

export const SFX_PACK_VERSION = '1.0.0';
/** Where anyone can read how the sounds were made and that they are CC0. */
export const SFX_SOURCE = 'https://github.com/taalcut/taalcut/tree/main/tools/audio-packs';
/** core SFX_CATEGORIES; packages/audio/test/packs/sfx-pack-build.int.test.ts checks they agree. */
export const CATEGORIES = ['whoosh', 'riser', 'impact', 'hit'];

/** Impacts and hits land their attack on the cut: their peak is looked for in the first 40 ms only (before any echo). */
const ATTACK_MS = { impact: 40, hit: 40 };

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

function checkRecipes(recipes) {
  const ids = new Set();
  for (const recipe of recipes) {
    if (!/^[a-z0-9-]{1,64}$/.test(recipe.id)) throw new Error(`${recipe.id}: not a pack id`);
    if (ids.has(recipe.id)) throw new Error(`${recipe.id}: twice`);
    if (!CATEGORIES.includes(recipe.category))
      throw new Error(`${recipe.id}: unknown category ${recipe.category}`);
    ids.add(recipe.id);
  }
}

/** Renders `recipes` into `out` (emptied first) and writes the catalogue and the dedication. */
export function buildSfxPack({ out, ffmpeg, recipes = SFX_RECIPES }) {
  checkRecipes(recipes);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'taalcut-sfx-pack-'));
  try {
    const items = recipes.map((recipe) => {
      const commandFile = join(scratch, `${recipe.id}.cmd`);
      if (recipe.commands) writeFileSync(commandFile, recipe.commands);
      const samples = renderGraph(ffmpeg, recipe.graph(commandFile));
      const file = `${recipe.id}.flac`;
      writeFlac(ffmpeg, normalisedPcm16(samples), join(out, file));
      const attackMs = ATTACK_MS[recipe.category];
      const shape = measureFile(ffmpeg, join(out, file), attackMs ? { attackMs } : {});
      return {
        id: recipe.id,
        title: recipe.title,
        category: recipe.category,
        file,
        durationMs: shape.durationMs,
        // The instant that lands on the cut: a riser's is its end.
        peakMs: recipe.category === 'riser' ? shape.durationMs : shape.peakMs,
        loudnessLufs: shape.loudnessLufs,
        licence: 'CC0-1.0',
        source: SFX_SOURCE,
      };
    });
    const catalogue = { version: 1, pack: 'sfx-pack', packVersion: SFX_PACK_VERSION, items };
    writeFileSync(join(out, 'catalogue.json'), `${JSON.stringify(catalogue, null, 2)}\n`);
    copyFileSync(join(HERE, 'CC0-sfx-pack.txt'), join(out, 'LICENCE.txt'));
    return { catalogue, files: ['catalogue.json', 'LICENCE.txt', ...items.map((item) => item.file)] };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      ffmpeg: { type: 'string' },
      only: { type: 'string' },
      'no-archive': { type: 'boolean' },
    },
  });
  const packs = join(REPO, 'packages', 'audio', '.cache', 'packs');
  const out = resolve(values.out ?? join(packs, 'sfx-pack'));
  const ffmpeg =
    values.ffmpeg ?? process.env.TAALCUT_FFMPEG ?? join(REPO, 'tools', 'ffmpeg', 'dist', 'ffmpeg');
  const only = values.only ? new Set(values.only.split(',')) : null;
  const recipes = only ? SFX_RECIPES.filter((recipe) => only.has(recipe.id)) : SFX_RECIPES;
  if (recipes.length === 0) throw new Error('--only names no recipe');
  const { catalogue, files } = buildSfxPack({ out, ffmpeg, recipes });
  const summary = { version: SFX_PACK_VERSION, out, sounds: catalogue.items.length };
  if (!values['no-archive']) {
    const archive = join(dirname(out), `sfx-pack-${SFX_PACK_VERSION}.tar.zst`);
    Object.assign(summary, { archive, ...writeArchive(out, files, archive) });
  }
  console.log(JSON.stringify(summary, null, 2));
}
