// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Read the earshot parity fixtures from tests (EAR1-F2). Import it by relative path, e.g. from
 * packages/audio/test/listen/x.test.ts: `import { loadClip, cliRun, blob } from
 * '../../../../tools/earshot-parity/fixtures.mjs'`. Types: fixtures.d.mts.
 *
 * Every file read is checked against the sha256 in fixtures/manifest.json, and a generated clip is regenerated
 * in memory and checked against the sha256 of the WAV upstream analysed, so a test never compares against data
 * that drifted. Nothing here needs FFmpeg, Python or the network, except writeFilmVideo (FFmpeg).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clipSpec, renderClip } from './gen/catalogue.mjs';
import { writeFilmVideo as encodeFilm } from './gen/video.mjs';
import { decodeWav, encodeWav } from './gen/wav.mjs';

export const PARITY_DIR = import.meta.dirname;
export const FIXTURES_DIR = join(PARITY_DIR, 'fixtures');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const memo = new Map();
const once = (key, make) => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
};

/** fixtures/manifest.json: clips, files with sha256, upstream commit, model revisions, versions, precision. */
export function manifest() {
  return once('manifest', () => JSON.parse(readFileSync(join(FIXTURES_DIR, 'manifest.json'), 'utf8')));
}

/** The bytes of a fixture file (path relative to fixtures/), checked against the manifest. */
export function fixtureBytes(rel) {
  return once(`bytes:${rel}`, () => {
    const entry = manifest().files[rel];
    if (!entry) throw new Error(`earshot parity: ${rel} is not in fixtures/manifest.json`);
    const bytes = readFileSync(join(FIXTURES_DIR, rel));
    if (sha256(bytes) !== entry.sha256)
      throw new Error(
        `earshot parity: ${rel} does not match its sha256 in the manifest (rebuild or restore it)`,
      );
    return bytes;
  });
}

export function fixtureJson(rel) {
  return once(`json:${rel}`, () => JSON.parse(fixtureBytes(rel).toString('utf8')));
}

/** Clip rows of the manifest, optionally of one category (music, sfx, speech, edge, texture, mix, film). */
export function clips(category) {
  const rows = manifest().clips;
  return category ? rows.filter((r) => r.category === category) : rows;
}

export function clip(id) {
  const row = manifest().clips.find((r) => r.id === id);
  if (!row) throw new Error(`earshot parity: no clip ${id}`);
  return row;
}

/** The exact WAV bytes upstream analysed (regenerated for generated clips, read for committed SFX renders). */
export function clipWavBytes(id) {
  return once(`wav:${id}`, () => {
    const row = clip(id);
    if (row.committed) return fixtureBytes(row.committed);
    const out = renderClip(clipSpec(id));
    const bytes = encodeWav({ sampleRate: out.sampleRate, channels: out.channels, format: 'f32' });
    if (sha256(bytes) !== row.sha256)
      throw new Error(`earshot parity: regenerated ${id} differs from the clip upstream analysed (sha256)`);
    return bytes;
  });
}

/**
 * A clip's samples as upstream decoded them (48 kHz float32; FFmpeg's int16 / 32768 for the 16-bit SFX files):
 * { id, sampleRate, channels, truth, row }.
 */
export function loadClip(id) {
  const row = clip(id);
  const { sampleRate, channels } = decodeWav(clipWavBytes(id));
  return { id, sampleRate, channels, truth: row.truth, row };
}

/**
 * earshot's `audio.to_mono` of the stereo decode: the mean of the channels (timeline events and sections, the
 * AST windows of describe on files over 20 s, measure's envelopes). A mono clip is returned as is.
 */
export function mono(loaded) {
  const [a, b] = loaded.channels;
  if (!b) return a;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = (a[i] + b[i]) / 2;
  return out;
}

/**
 * earshot's `audio.load(mono=True)`: FFmpeg's `-ac 1` downmix, which for a stereo file is (L + R) * sqrt(1/2),
 * 3 dB hotter than the mean (earshot.vocab's CLAP windows for describe / match / rank / find / compare, realness,
 * and AST on files up to 20 s read this; measured within 7e-8 of FFmpeg 9). A mono clip is returned as is.
 */
export function ffmpegMono(loaded) {
  const [a, b] = loaded.channels;
  if (!b) return a;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = (a[i] + b[i]) * Math.SQRT1_2;
  return out;
}

/** Write a clip's WAV into `dir` (for FFmpeg-based tests); returns its path, named `<id>.wav` as upstream saw it. */
export function writeClip(id, dir) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.wav`);
  writeFileSync(path, clipWavBytes(id));
  return path;
}

/** Encode a film's picture (flat cards, cuts on frames) as `<id>.mp4` in `dir` with the given FFmpeg. */
export async function writeFilmVideo(id, dir, ffmpeg = 'ffmpeg') {
  const row = clip(id);
  if (row.category !== 'film') throw new Error(`earshot parity: ${id} is not a film`);
  mkdirSync(dir, { recursive: true });
  return encodeFilm({ ffmpeg, truth: row.truth, path: join(dir, `${id}.mp4`) });
}

/** Every run of one upstream command: { runId: { argv, exit, result } } (fixtures/cli/<command>.json). */
export function cli(command) {
  return fixtureJson(`cli/${command}.json`);
}

/** One run's result; throws when the run is missing. */
export function cliRun(command, runId) {
  const run = cli(command)[runId];
  if (!run) throw new Error(`earshot parity: no ${command} run ${runId}`);
  return run.result;
}

/** A JSON intermediate (fixtures/intermediates/<name>.json): text, clap-audio, borderline, clap-features, ast,
 * onsets, beats, sections, realness. */
export function intermediate(name) {
  return fixtureJson(`intermediates/${name}.json`);
}

/** The float32 array index (fixtures/intermediates/index.json): `group/key` -> { file, offset, shape, ... }. */
export function blobIndex() {
  return fixtureJson('intermediates/index.json').arrays;
}

/** One float32 array, e.g. blob('clap-audio-windows/music-080-cmaj'): a Float32Array with its shape. */
export function blob(key) {
  const info = blobIndex()[key];
  if (!info) throw new Error(`earshot parity: no array ${key}`);
  const bytes = fixtureBytes(`intermediates/${info.file}`);
  const size = info.shape.reduce((a, b) => a * b, 1);
  const data = new Float32Array(size);
  const view = new DataView(bytes.buffer, bytes.byteOffset + info.offset * 4, size * 4);
  for (let i = 0; i < size; i += 1) data[i] = view.getFloat32(i * 4, true);
  return { data, shape: info.shape, info };
}

/** The rows of a 2-D (or the vectors of an N-D) array as Float32Array views over the last axis. */
export function blobRows(key) {
  const { data, shape } = blob(key);
  const width = shape.at(-1) ?? data.length;
  const rows = [];
  for (let at = 0; at < data.length; at += width) rows.push(data.subarray(at, at + width));
  return rows;
}

/** A kit preset as upstream wrote it: kit.json (kit init) and kit.lock.json (kit render). */
export function kit(preset) {
  return { kit: fixtureJson(`kits/${preset}/kit.json`), lock: fixtureJson(`kits/${preset}/kit.lock.json`) };
}
