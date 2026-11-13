// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F4 decode: media's FFmpeg extract, scaled to earshot's `audio.load(mono=True)` level, gives upstream's
 * samples for a mono clip and a stereo film; `timelineMono` gives timeline.py's mean. Needs the dev FFmpeg.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeClip } from '../../../../tools/earshot-parity/fixtures.mjs';
import { embedAudioFile, embedPcm } from '../../src/listen/models/embed';
import { decodeListenAudio, timelineMono } from '../../src/listen/models/pcm';
import type { ClapAudioEncoder } from '../../src/listen/models/clap-audio';
import { testMedia } from '../helpers/ffmpeg';
import { modelMono, timelineMonoOf } from './models-helpers';

const media = await testMedia('listen decode');
let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'listen-pcm-'));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function maxDiff(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return worst;
}

describe.skipIf(!media.ctx)(`decodeListenAudio${media.skip ? ` (${media.skip})` : ''}`, () => {
  const ctx = media.ctx as MediaContext;

  it.each(['speech-01', 'film-03'])('%s: the samples upstream heard, within 1e-6', async (id) => {
    const decoded = await decodeListenAudio(writeClip(id, dir), { media: ctx });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(maxDiff(decoded.value.samples, modelMono(id))).toBeLessThan(1e-6);
    expect(maxDiff(timelineMono(decoded.value), timelineMonoOf(id))).toBeLessThan(1e-6);
  });

  it('embedAudioFile decodes and embeds; embedPcm wants 48 kHz', async () => {
    const seen: number[] = [];
    const clap = {
      embedSource: async (samples: Float32Array) => {
        seen.push(samples.length);
        return { ok: true, value: { spans: [], windows: [], pooled: new Float32Array(512) } };
      },
    } as unknown as ClapAudioEncoder;
    const embedded = await embedAudioFile(clap, writeClip('speech-01', dir), { media: ctx });
    expect(embedded.ok).toBe(true);
    expect(seen).toEqual([modelMono('speech-01').length]);
    const wrong = await embedPcm(clap, new Float32Array(16_000), 16_000);
    expect(!wrong.ok && wrong.error.code).toBe('audio.listen_bad_input');
  });

  it('a file with no audio is bad input', async () => {
    const missing = await decodeListenAudio(join(dir, 'nothing.wav'), { media: ctx });
    expect(!missing.ok && missing.error.code).toBe('audio.listen_bad_input');
  });
});
