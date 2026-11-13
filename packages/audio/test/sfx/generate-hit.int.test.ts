// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `sfx.generateHit` (SPEC P3.6): a provider sound is stored byte for byte as a generated asset, measured with FFmpeg,
 * and placed with its peak on each chosen cut, next to the hits already there; an unknown cut costs nothing.
 */
import { createHash } from 'node:crypto';
import { FrameRate, ok, RationalTime, type SfxProvider, type SfxRequest } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLoudnessMeter } from '../../src/mix/loudness-series';
import { encodeFloatWav } from '../../src/pcm/pcm';
import { timelineCuts } from '../../src/sfx/cuts';
import { generateHit } from '../../src/sfx/generate-hit';
import { testMedia } from '../helpers/ffmpeg';
import { memorySink } from '../helpers/sinks';
import { makeTestTimeline } from '../helpers/timeline';

let media: MediaContext;
const found = await testMedia('generate-hit');
if (!found.ctx) console.warn(found.skip);

beforeAll(async () => {
  if (!found.ctx) return;
  media = found.ctx;
});

const RATE = 48_000;
/** A 2 s sound whose loudest instant is at 300 ms: a decaying 120 Hz thump. */
function thump(): Uint8Array {
  const data = new Float32Array(2 * RATE);
  const peak = 0.3 * RATE;
  for (let i = 0; i < data.length; i++) {
    const envelope = i < peak ? (i / peak) ** 2 : Math.exp(-(i - peak) / (0.1 * RATE));
    data[i] = 0.8 * envelope * Math.sin((2 * Math.PI * 120 * i) / RATE);
  }
  return new Uint8Array(encodeFloatWav({ sampleRate: RATE, channels: [data] }));
}

function provider(): SfxProvider & { readonly requests: SfxRequest[] } {
  const requests: SfxRequest[] = [];
  const bytes = thump();
  return {
    requests,
    available: () => ({ ok: true }),
    async generate(request) {
      requests.push(request);
      return ok({
        bytes,
        mediaType: 'audio/wav',
        provider: 'test',
        model: 'eleven_text_to_sound_v2',
        costUsd: 0.004,
        c2pa: 'absent',
      });
    },
  };
}

const timeline = makeTestTimeline({
  rate: FrameRate.of(30),
  clips: [{ frames: 60 }, { frames: 60 }, { frames: 90 }],
});

describe.skipIf(!found.ctx)('sfx.generateHit', () => {
  it('stores the sound as generated and lands its peak on each chosen cut', async () => {
    const sink = memorySink();
    const sfx = provider();
    const deps = {
      sink,
      provider: sfx,
      media,
      meter: createLoudnessMeter({ media }),
      clock: { now: () => 7 },
    };
    const made = await generateHit(deps, { timeline, prompt: 'deep cinematic thump', cutIndexes: [0, 1] });
    if (!made.ok) throw new Error(made.error.code);
    expect(sfx.requests).toMatchObject([{ durationSeconds: 2, loop: false }]);
    const [stored] = [...sink.files.values()];
    expect(stored?.provenance).toMatchObject({
      kind: 'generated',
      generation: 'soundEffect',
      c2pa: 'absent',
      costUsd: 0.004,
    });
    expect(stored && createHash('sha256').update(stored.bytes).digest('hex')).toBe(
      createHash('sha256').update(thump()).digest('hex'),
    );
    expect(made.value.hits).toHaveLength(2);
    const cutsMs = timelineCuts(timeline).map((cut) => cut.ms);
    for (const [i, hit] of made.value.hits.entries()) {
      // The hit starts so that its peak (300 ms in, measured) sits on the cut, within a 40 ms meter hop.
      const peakAt =
        RationalTime.toSeconds(hit.at) * 1000 + 300 - RationalTime.toSeconds(hit.sourceStart) * 1000;
      expect(Math.abs(peakAt - (cutsMs[i] ?? 0))).toBeLessThanOrEqual(40);
      expect(hit.assetId).toBe(made.value.assetId);
    }
  });

  it('refuses an unknown cut before asking the provider for anything', async () => {
    const sfx = provider();
    const deps = {
      sink: memorySink(),
      provider: sfx,
      media,
      meter: createLoudnessMeter({ media }),
      clock: { now: () => 7 },
    };
    const made = await generateHit(deps, { timeline, prompt: 'whoosh', cutIndexes: [9] });
    expect(made.ok ? 'ok' : made.error.code).toBe('audio.cut_unknown');
    expect(sfx.requests).toEqual([]);
  });
});
