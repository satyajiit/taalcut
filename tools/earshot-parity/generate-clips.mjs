#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Write the generated parity clips (float32 WAV, 48 kHz) and the fixture films (soundtrack WAV, plus the picture
 * as MP4 with --video), with clips.json: each clip's id, category, parameters, planted truth and sha256.
 *
 *   node tools/earshot-parity/generate-clips.mjs --out <dir> [--video] [--ffmpeg <path>] [--only <id,...>]
 *
 * The SFX clips are committed renders of upstream's bank (fixtures/clips/sfx) and are not written here.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { FILMS, GENERATED, renderClip } from './gen/catalogue.mjs';
import { writeFilmVideo } from './gen/video.mjs';
import { encodeWav } from './gen/wav.mjs';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    video: { type: 'boolean', default: false },
    ffmpeg: { type: 'string', default: 'ffmpeg' },
    only: { type: 'string' },
  },
});
if (!values.out) {
  console.error('usage: generate-clips.mjs --out <dir> [--video] [--ffmpeg <path>] [--only <id,...>]');
  process.exit(2);
}
const only = values.only ? new Set(values.only.split(',')) : null;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

mkdirSync(values.out, { recursive: true });
const rows = [];
for (const spec of [...GENERATED, ...FILMS]) {
  if (only && !only.has(spec.id)) continue;
  const started = performance.now();
  const clip = renderClip(spec);
  const wav = encodeWav({ sampleRate: clip.sampleRate, channels: clip.channels, format: 'f32' });
  const file = `${spec.id}.wav`;
  writeFileSync(join(values.out, file), wav);
  const row = {
    id: spec.id,
    category: spec.category,
    kind: spec.kind,
    file,
    sha256: sha256(wav),
    bytes: wav.length,
    sampleRate: clip.sampleRate,
    channels: clip.channels.length,
    samples: clip.channels[0].length,
    seconds: clip.channels[0].length / clip.sampleRate,
    params: spec.params,
    truth: clip.truth,
  };
  if (spec.category === 'film' && values.video) {
    row.video = `${spec.id}.mp4`;
    await writeFilmVideo({ ffmpeg: values.ffmpeg, truth: clip.truth, path: join(values.out, row.video) });
  }
  rows.push(row);
  console.log(`${spec.id}: ${row.seconds.toFixed(3)} s, ${(performance.now() - started).toFixed(0)} ms`);
}
writeFileSync(join(values.out, 'clips.json'), `${JSON.stringify(rows, null, 1)}\n`);
console.log(`wrote ${rows.length} clips to ${values.out}`);
