// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R1, decoding a file for listening with the real FFmpeg: a range is decoded on its own (with a margin) and
 * gives the samples the whole file sliced gives, for a 44.1 kHz WAV and an AAC file; one second of an 11-minute
 * file decodes (the whole file would be over the decode's 10-minute limit, which is `listen_bad_input`, not a retry);
 * a range past the end is `listen_bad_input`; an aborted decode is core.cancelled, not a failure to retry.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RationalTime, type TimeRange } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeListenSource, sliceListenAudio } from '../../src/listen/analysis/source';
import { decodeListenAudio } from '../../src/listen/models/pcm';
import { testMedia } from '../helpers/ffmpeg';

const media = await testMedia('listen source');
const ms = (s: number) => RationalTime.fromSeconds(s, { num: 1000, den: 1 });
const range = (start: number, duration: number): TimeRange => ({ start: ms(start), duration: ms(duration) });
let dir = '';

function make(ctx: MediaContext, name: string, args: readonly string[]): string {
  const path = join(dir, name);
  execFileSync(ctx.binaries.ffmpeg, ['-v', 'error', '-y', ...args, path]);
  return path;
}

/** Noise with a tone on each side, so a misaligned sample shows. */
const SOURCE = [
  '-f',
  'lavfi',
  '-i',
  'anoisesrc=d=20:c=pink:r=44100:a=0.3:s=7',
  '-f',
  'lavfi',
  '-i',
  'sine=f=997:d=20:r=44100',
];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'listen-source-'));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!media.ctx)(`a range decoded on its own${media.skip ? ` (${media.skip})` : ''}`, () => {
  const ctx = () => media.ctx as MediaContext;

  it.each([
    ['a 44.1 kHz stereo WAV', 'mix.wav', ['-c:a', 'pcm_s16le']],
    ['an AAC file', 'mix.m4a', ['-c:a', 'aac', '-b:a', '128k']],
  ] as const)('%s: the same samples as the whole file sliced', async (_label, name, codec) => {
    const path = make(ctx(), name, [
      ...SOURCE,
      '-filter_complex',
      '[0][1]amerge=inputs=2',
      '-ac',
      '2',
      ...codec,
    ]);
    const whole = await decodeListenSource(path, { media: ctx() });
    expect(whole.ok).toBe(true);
    if (!whole.ok) return;
    for (const [start, duration] of [
      [0, 1],
      [3.2, 1.5],
      [7.123, 0.25],
      [18.5, 5],
    ] as const) {
      const part = await decodeListenSource(path, { media: ctx(), range: range(start, duration) });
      expect(part.ok).toBe(true);
      if (!part.ok) continue;
      const expected = sliceListenAudio(whole.value.audio, range(start, duration));
      expect(part.value.audio.channels).toHaveLength(2);
      part.value.audio.channels.forEach((channel, c) => {
        const want = expected.channels[c] as Float32Array;
        expect(channel.length).toBe(want.length);
        let worst = 0;
        for (let i = 0; i < channel.length; i++)
          worst = Math.max(worst, Math.abs((channel[i] ?? 0) - (want[i] ?? 0)));
        expect(worst).toBeLessThan(1e-6);
      });
    }
  });

  it(
    'one second of an 11-minute file decodes; the whole of it is listen_bad_input, not a retry',
    { timeout: 120_000 },
    async () => {
      const path = make(ctx(), 'long.m4a', [
        '-f',
        'lavfi',
        '-i',
        'sine=f=440:d=660',
        '-ac',
        '2',
        '-c:a',
        'aac',
        '-b:a',
        '32k',
      ]);
      const part = await decodeListenSource(path, { media: ctx(), range: range(5, 1) });
      expect(part.ok && part.value.audio.channels[0]?.length).toBe(48_000);
      const whole = await decodeListenSource(path, { media: ctx() });
      expect(!whole.ok && whole.error).toMatchObject({ code: 'audio.listen_bad_input', retryable: false });
    },
  );

  it('a range past the end is listen_bad_input', async () => {
    const path = make(ctx(), 'short.wav', ['-f', 'lavfi', '-i', 'sine=f=440:d=2', '-ac', '2']);
    const past = await decodeListenSource(path, { media: ctx(), range: range(10, 2) });
    expect(!past.ok && past.error.code).toBe('audio.listen_bad_input');
  });

  it('an aborted decode is core.cancelled, for the analysis decode and the models’ decode', async () => {
    const path = make(ctx(), 'abort.wav', ['-f', 'lavfi', '-i', 'anoisesrc=d=300:r=48000', '-ac', '2']);
    for (const decode of [decodeListenSource, decodeListenAudio] as const) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 30);
      const decoded = await decode(path, { media: ctx(), signal: controller.signal });
      expect(!decoded.ok && decoded.error.code).toBe('core.cancelled');
    }
  });
});
