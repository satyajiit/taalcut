// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pack build scripts (tools/audio-packs) against the catalogue readers the app uses: what
 * build-sfx-pack.mjs writes loads through loadSfxPack with the peaks the hit planner expects and rebuilds to the
 * same bytes; build-music-pack.mjs writes what loadMusicPack reads, and refuses an empty list and a track whose
 * licence file doesn't say CC0. Real FFmpeg, audio only.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SFX_CATEGORIES } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMusicPack } from '../../src/music/library-catalogue';
import { loadSfxPack } from '../../src/sfx/pack-catalogue';
import { testMedia } from '../helpers/ffmpeg';

const PACKS = join(import.meta.dirname, '..', '..', '..', '..', 'tools', 'audio-packs');

interface Recipe {
  readonly id: string;
  readonly category: string;
  readonly seconds: number;
}
interface SfxBuild {
  buildSfxPack(options: { out: string; ffmpeg: string; recipes?: readonly Recipe[] }): { files: string[] };
  CATEGORIES: readonly string[];
}
interface Archive {
  writeArchive(dir: string, names: readonly string[], path: string): { sha256: string; size: number };
}

/** A plain .mjs tool script (no types), loaded by URL. */
const load = async <T>(name: string) => (await import(pathToFileURL(join(PACKS, name)).href)) as T;

let media: MediaContext;
let scratch: string;
let build: SfxBuild;
let archive: Archive;
let recipes: readonly Recipe[];

const found = await testMedia('audio packs');
if (!found.ctx) console.warn(found.skip);

beforeAll(async () => {
  if (!found.ctx) return;
  media = found.ctx;
  scratch = await mkdtemp(join(tmpdir(), 'taalcut-packs-'));
  build = await load<SfxBuild>('build-sfx-pack.mjs');
  archive = await load<Archive>('pack-archive.mjs');
  recipes = (await load<{ SFX_RECIPES: readonly Recipe[] }>('sfx-sounds.mjs')).SFX_RECIPES;
});
afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

const pick = (...ids: string[]) => recipes.filter((r) => ids.includes(r.id));

describe.skipIf(!found.ctx)('the synthesised sound pack (build-sfx-pack.mjs)', () => {
  it('holds eight sounds of each of core’s categories', () => {
    expect(build.CATEGORIES).toEqual([...SFX_CATEGORIES]);
    expect(recipes).toHaveLength(32);
    for (const category of SFX_CATEGORIES)
      expect(recipes.filter((r) => r.category === category)).toHaveLength(8);
  });

  it('writes a catalogue loadSfxPack reads, with the peak where the hit planner lands it', async () => {
    const out = join(scratch, 'sfx');
    const chosen = pick('whoosh-soft', 'riser-short', 'impact-boom', 'hit-clap');
    build.buildSfxPack({ out, ffmpeg: media.binaries.ffmpeg, recipes: chosen });
    const pack = await loadSfxPack(out);
    if (!pack.ok) throw new Error(`${pack.error.code}: ${pack.error.detail ?? ''}`);
    const byId = new Map(pack.value.items.map((item) => [item.id, item]));
    const whoosh = byId.get('whoosh-soft');
    expect(whoosh?.durationMs).toBe(900);
    // The swell's peak: about where the recipe puts it (0.5 s).
    expect(whoosh?.peakMs).toBeGreaterThan(400);
    expect(whoosh?.peakMs).toBeLessThan(600);
    const riser = byId.get('riser-short');
    expect(riser?.peakMs).toBe(riser?.durationMs);
    // An impact with an echo tail still lands its attack, not the echo, on the cut.
    expect(byId.get('impact-boom')?.peakMs).toBeLessThan(40);
    expect(byId.get('impact-boom')?.durationMs).toBeGreaterThan(2000);
    expect(byId.get('hit-clap')?.peakMs).toBeLessThan(40);
    for (const item of pack.value.items) {
      expect(item.loudnessLufs).toBeGreaterThan(-40);
      expect(item.loudnessLufs).toBeLessThan(0);
    }
    expect(await readFile(join(out, 'LICENCE.txt'), 'utf8')).toMatch(/CC0 1\.0 Universal/);
  });

  it('rebuilds to the same archive bytes', () => {
    const chosen = pick('whoosh-fast', 'hit-tick');
    const sha = (name: string) => {
      const out = join(scratch, name);
      const { files } = build.buildSfxPack({ out, ffmpeg: media.binaries.ffmpeg, recipes: chosen });
      return archive.writeArchive(out, files, join(scratch, `${name}.tar.zst`)).sha256;
    };
    expect(sha('first')).toBe(sha('second'));
  });
});

describe.skipIf(!found.ctx)('the music pack (build-music-pack.mjs)', () => {
  const script = join(PACKS, 'build-music-pack.mjs');
  const run = (args: string[]) => {
    try {
      execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' });
      return { code: 0, stderr: '' };
    } catch (cause) {
      const failed = cause as { status: number; stderr: Buffer };
      return { code: failed.status, stderr: failed.stderr.toString() };
    }
  };

  async function source(licence: string) {
    const from = await mkdtemp(join(scratch, 'from-'));
    execFileSync(media.binaries.ffmpeg, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3:sample_rate=48000',
      '-c:a',
      'flac',
      join(from, 'Download.flac'),
    ]);
    await writeFile(join(from, 'licence.txt'), licence);
    const tracks = join(from, 'tracks.json');
    const entry = {
      id: 'test-tone',
      title: 'Test tone',
      file: 'Download.flac',
      licenceFile: 'licence.txt',
      bpm: 100,
      moods: ['calm'],
      sourceUrl: 'https://example.org/tone',
      dedicationUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    };
    await writeFile(tracks, JSON.stringify({ packVersion: '0.1.0', tracks: [entry] }));
    return { from, tracks, out: join(from, 'pack') };
  }

  it('refuses the empty list it ships with', () => {
    const refused = run(['--out', join(scratch, 'never')]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/lists no tracks/);
  });

  it('builds a pack loadMusicPack reads, the track kept byte for byte with its licence', async () => {
    const { from, tracks, out } = await source('Dedicated to the public domain: CC0 1.0 Universal.');
    const built = run([
      '--tracks',
      tracks,
      '--from',
      from,
      '--out',
      out,
      '--ffprobe',
      media.binaries.ffprobe,
    ]);
    expect(built).toEqual({ code: 0, stderr: '' });
    const pack = await loadMusicPack(out);
    if (!pack.ok) throw new Error(`${pack.error.code}: ${pack.error.detail ?? ''}`);
    const [track] = pack.value.tracks;
    if (!track) throw new Error('no track');
    expect(track).toMatchObject({ id: 'test-tone', file: 'test-tone.flac', bpm: 100, licence: 'CC0-1.0' });
    expect(track.seconds).toBeCloseTo(3, 1);
    expect(await readFile(pack.value.pathOf(track))).toEqual(await readFile(join(from, 'Download.flac')));
    expect(await readFile(join(out, 'test-tone.licence.txt'), 'utf8')).toMatch(/CC0/);
  });

  it('refuses a track whose licence file does not say CC0', async () => {
    const { from, tracks, out } = await source('Creative Commons Attribution 4.0');
    const refused = run([
      '--tracks',
      tracks,
      '--from',
      from,
      '--out',
      out,
      '--ffprobe',
      media.binaries.ffprobe,
    ]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/does not say CC0/);
  });
});
