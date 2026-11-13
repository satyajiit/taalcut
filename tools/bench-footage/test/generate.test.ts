// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A two-clip set made for real with the bundled FFmpeg and `say` (small, so it takes seconds; both H.264, so
 * OpenH264 encodes them and VideoToolbox is not used: brief-common "VideoToolbox stalls"): the files play
 * for their length, the portrait clip is stored landscape with its rotation tag, the speech and metadata are
 * there, and the manifest matches until a file or the spec changes.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureFootage, generateSet } from '../src/generate';
import { checkFootage, readManifest, type Manifest } from '../src/manifest';
import { refinishSet } from '../src/refinish';
import type { FootageSet } from '../src/sets/types';
import { bundledFfmpeg, systemTools } from '../src/tools';
import { STARTS_PROCESSES } from './starts-processes';

const TINY: FootageSet = {
  name: 'tiny',
  version: 1,
  seed: 7,
  looksProbe: 'colour bars',
  clips: [
    {
      file: 'harbour-h264-en.mov',
      ...{ width: 640, height: 360, fps: 30, codec: 'h264', bitrate: '2M', seconds: 14, bed: 'music' },
      createdAt: '2026-09-12T08:00:00Z',
      speech: {
        language: 'en',
        voices: ['Samantha', 'Daniel'],
        text: 'The lighthouse blinks at dawn.',
        probe: 'lighthouse',
      },
      onScreen: ['PIER 39'],
      bars: true,
    },
    {
      file: 'street-portrait-h264.mp4',
      ...{ width: 360, height: 640, fps: 30, codec: 'h264', bitrate: '2M', seconds: 14, bed: 'room' },
      createdAt: '2026-09-12T09:00:00Z',
      speech: { language: 'es', voices: ['No Such Voice'], text: 'Hola.', probe: null },
      onScreen: [],
      bars: false,
    },
  ],
};

/**
 * A real generation needs the bundled FFmpeg (tools/ffmpeg/build.sh) and `say`: a Mac with the
 * build. CI's unit-test job has no FFmpeg build, so there this file skips; run it under the encoder lock.
 */
const ffmpeg = bundledFfmpeg() ?? '';
const RUNNABLE = ffmpeg !== '' && process.platform === 'darwin' && existsSync('/usr/bin/say');
const ffprobe = join(ffmpeg, '..', 'ffprobe');

let root = '';
let out = '';
let manifest: Manifest;

beforeAll(async () => {
  if (!RUNNABLE) return;
  root = mkdtempSync(join(tmpdir(), 'taalcut-footage-'));
  out = join(root, 'tiny');
  manifest = await generateSet(TINY, out, systemTools(ffmpeg, { reportDir: join(root, 'stalls') }));
}, 120_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function probe(file: string): Record<string, string> {
  const text = execFileSync(ffprobe, [
    ...['-v', 'error', '-show_entries'],
    'format=duration:format_tags=creation_time:stream=codec_name,codec_type,width,height:stream_side_data=rotation',
    ...['-of', 'flat', join(out, file)],
  ]).toString();
  return Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map((line) => {
        const [key = '', value = ''] = line.split('=');
        return [key, value.replaceAll('"', '')];
      }),
  );
}

describe.skipIf(!RUNNABLE)('generateSet', STARTS_PROCESSES, () => {
  it('makes each clip at its length, codec and picture, with speech under the music', () => {
    const harbour = probe('harbour-h264-en.mov');
    expect(Number(harbour['format.duration'])).toBeCloseTo(14, 0);
    expect(harbour['streams.stream.0.codec_name']).toBe('h264');
    expect(harbour['streams.stream.0.width']).toBe('640');
    expect(harbour['streams.stream.1.codec_type']).toBe('audio');
    expect(harbour['format.tags.creation_time']).toMatch(/^2026-09-12T08:00:00/);
  });

  it('stores the portrait clip landscape with a -90 rotation tag', () => {
    const portrait = probe('street-portrait-h264.mp4');
    expect(portrait['streams.stream.0.codec_name']).toBe('h264');
    expect([portrait['streams.stream.0.width'], portrait['streams.stream.0.height']]).toEqual(['640', '360']);
    expect(portrait['streams.stream.0.side_data_list.side_data.0.rotation']).toBe('-90');
  });

  it('writes a manifest with the voices used, the cuts and the checksums', async () => {
    expect(readManifest(out)).toEqual(manifest);
    const [harbour, portrait] = manifest.clips;
    expect(harbour?.speech).toMatchObject({ language: 'en', probe: 'lighthouse' });
    expect(['Samantha', 'Daniel']).toContain(harbour?.speech?.voice);
    expect(harbour?.onScreen.map((text) => text.line)).toEqual(['PIER 39']);
    expect(harbour?.shots.some((shot) => shot.look === 'bars')).toBe(true);
    expect(portrait?.speech).toBeNull();
    expect(portrait?.speechSkipped).toContain('No Such Voice');
    expect(portrait?.rotation).toBe(-90);
    expect(manifest.totalSeconds).toBe(28);
    expect(manifest.generator.ffmpeg).toMatch(/^ffmpeg version/);
    expect((await checkFootage(out, TINY, { checksums: true })).ok).toBe(true);
  });

  it('writes one creation time into an .mp4, and finishes it again without re-encoding', async () => {
    const tags = () =>
      execFileSync(ffprobe, [
        ...['-v', 'error', '-show_entries', 'format_tags=creation_time', '-of', 'default=nw=1:nk=1'],
        join(out, 'street-portrait-h264.mp4'),
      ])
        .toString()
        .trim();
    expect(tags()).toBe('2026-09-12T09:00:00.000000Z');
    const tools = systemTools(ffmpeg, { reportDir: join(root, 'stalls') });
    const again = await refinishSet(TINY, out, tools, (file) => file.endsWith('.mp4'));
    expect(tags()).toBe('2026-09-12T09:00:00.000000Z');
    expect(again.clips[0]).toEqual(manifest.clips[0]);
    expect((await checkFootage(out, TINY, { checksums: true })).ok).toBe(true);
  });

  it('reuses a matching set and remakes one that changed', async () => {
    const tools = systemTools(ffmpeg, { reportDir: join(root, 'stalls') });
    expect((await ensureFootage(TINY, out, tools)).generated).toBe(false);
    expect(await checkFootage(out, { ...TINY, seed: 8 })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('spec hash'),
    });
    expect(await checkFootage(join(root, 'nothing'), TINY)).toMatchObject({ ok: false });
    appendFileSync(join(out, 'street-portrait-h264.mp4'), 'x');
    expect(await checkFootage(out, TINY)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('changed size'),
    });
  });
});
