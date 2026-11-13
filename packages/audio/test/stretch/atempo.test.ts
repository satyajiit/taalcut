// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { atempoGraph, atempoRefuses, createAtempoStretcher } from '../../src/stretch/atempo';
import { createTimeStretcher } from '../../src/stretch/select';
import { StretchFailed } from '../../src/stretch/errors';
import { err } from '@taalcut/core';
import { testMedia } from '../helpers/ffmpeg';

const RATE = 48_000;
const tone = (seconds: number) => {
  const data = new Float32Array(seconds * RATE);
  for (let i = 0; i < data.length; i++) data[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE);
  return { sampleRate: RATE, channels: [data, data.slice()] };
};

const media = await testMedia('atempo');
if (!media.ctx) console.warn(media.skip);

describe('atempo engine', () => {
  it('refuses ratios outside 0.90–1.10 and builds one graph for the rest', () => {
    expect(atempoRefuses([{ sourceStart: 0, sourceEnd: 100, targetLength: 105 }])).toBeNull();
    expect(atempoRefuses([{ sourceStart: 0, sourceEnd: 100, targetLength: 115 }])).toBeCloseTo(1.15);
    const graph = atempoGraph([
      { sourceStart: 0, sourceEnd: 1000, targetLength: 1050 },
      { sourceStart: 1000, sourceEnd: 2000, targetLength: 950 },
    ]);
    expect(graph).toContain('atempo=0.952381');
    expect(graph).toContain('apad=whole_len=1050');
    expect(graph).toContain('concat=n=2:v=0:a=1[out]');
  });

  it.skipIf(!media.ctx)('stretches every segment to its exact length, stereo kept', async () => {
    const { ctx } = media;
    if (!ctx) return;
    const stretcher = createAtempoStretcher({ media: ctx });
    const out = await stretcher.stretch(tone(2), [
      { sourceStart: 0, sourceEnd: RATE, targetLength: Math.round(1.08 * RATE) },
      { sourceStart: RATE, sourceEnd: 2 * RATE, targetLength: Math.round(0.93 * RATE) },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.channels).toHaveLength(2);
    expect(out.value.channels[0]?.length).toBe(Math.round(1.08 * RATE) + Math.round(0.93 * RATE));
    const refused = await stretcher.stretch(tone(1), [
      { sourceStart: 0, sourceEnd: RATE, targetLength: 1.2 * RATE },
    ]);
    expect(refused.ok ? null : refused.error.code).toBe('audio.stretch_unavailable');
  });

  it.skipIf(!media.ctx)(
    'is the fallback only when Signalsmith is missing, and logs the CPU stretch once',
    async () => {
      const { ctx } = media;
      if (!ctx) return;
      const events: unknown[] = [];
      const preferred = await createTimeStretcher({ media: ctx, onComputeFallback: (e) => events.push(e) });
      expect(preferred.ok && preferred.value.engine).toBe('signalsmith');
      const fallback = await createTimeStretcher({
        media: ctx,
        onComputeFallback: (e) => events.push(e),
        loadModule: async () => err(StretchFailed(undefined, { detail: 'missing' })),
      });
      expect(fallback.ok && fallback.value.engine).toBe('atempo');
      if (!fallback.ok) return;
      const segments = [{ sourceStart: 0, sourceEnd: RATE, targetLength: RATE }];
      await fallback.value.stretch(tone(1), segments);
      await fallback.value.stretch(tone(1), segments);
      expect(events).toEqual([
        {
          operation: 'audio.timeStretch',
          wanted: [],
          reason: 'no_accelerator',
          detail: 'time-stretch on the CPU (atempo)',
        },
      ]);
    },
  );
});
