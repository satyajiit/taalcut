// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R1, cancellation: the request's signal reaches every DSP stage (events, tempo grid, key, measure, audit and
 * the critique). Aborting a 5-minute analysis 200 ms in returned after the whole DSP (17–28 s on the f64 oracle);
 * it now returns core.cancelled within a slice of work. Slicing changes nothing: the abortable runner's
 * spectrograms and segment powers, and the sliced resampler, are bit for bit what one call gives.
 */
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { analyseSound } from '../../src/listen/analysis/analyse';
import { createSoundCritic } from '../../src/listen/critique/critic';
import { abortableRunner } from '../../src/listen/dsp/abortable-runner';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { glideSpec, pulseSpec } from '../../src/listen/dsp/spectra';
import { centredFrames, frameSignal } from '../../src/listen/dsp/transforms';
import { realnessOf } from '../../src/listen/realness/realness';
import { resampleFrom48k, resampleFrom48kAbortable } from '../../src/listen/realness/resample';

const SR = 48_000;
const runner = createSpectrogramRunner({ plan: { devices: ['cpu'] } });
const deps = { spectrograms: async () => runner };

function noise(seconds: number, seed = 1): Float32Array {
  const x = new Float32Array(SR * seconds);
  let s = seed;
  for (let i = 0; i < x.length; i++) {
    s = (s * 16807) % 2147483647;
    x[i] = ((s / 2147483647) * 2 - 1) * 0.2 * (1 + Math.sin(i / SR));
  }
  return x;
}

async function abortAfter(ms: number, run: (signal: AbortSignal) => Promise<unknown>) {
  const controller = new AbortController();
  const t0 = performance.now();
  setTimeout(() => controller.abort(), ms);
  const result = await run(controller.signal);
  return { result, ms: performance.now() - t0 };
}

describe('aborting an analysis', () => {
  const x = noise(300);
  const pcm = { sampleRate: SR, channels: [x, x] };

  it(
    'a 5-minute DSP analysis returns core.cancelled soon after the abort',
    { timeout: 120_000 },
    async () => {
      const { result, ms } = await abortAfter(200, (signal) =>
        analyseSound(deps, {
          pcm,
          want: { measures: true, events: true, audit: true, key: true, tempo: true },
          signal,
        }),
      );
      expect(result).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
      // Before EAR1-R1: 17 s or more. A slice is well under a second of CPU; the bound allows a busy machine.
      expect(ms).toBeLessThan(5_000);
    },
  );

  it(
    'the critique stops too (nothing else asked: the abort lands inside it)',
    { timeout: 120_000 },
    async () => {
      let critiqueStarted = 0;
      const critic = createSoundCritic();
      const critiqued = {
        ...deps,
        critique: (input: Parameters<typeof critic>[0]) => (
          (critiqueStarted = performance.now()),
          critic(input)
        ),
      };
      const t0 = performance.now();
      const { result, ms } = await abortAfter(300, (signal) =>
        analyseSound(critiqued, { pcm, want: {}, critique: { profile: 'launch' }, signal }),
      );
      expect(critiqueStarted - t0).toBeLessThan(300);
      expect(result).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
      expect(ms).toBeLessThan(5_000);
    },
  );
});

describe('realness', () => {
  it('stops between its windows: an aborted signal embeds nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    let embedded = 0;
    const clap = {
      embedSegments: async (segments: readonly Float32Array[]) => ((embedded += segments.length), ok([])),
    };
    const scored = await realnessOf(noise(60, 3), clap, { signal: controller.signal });
    expect(!scored.ok && scored.error.code).toBe('core.cancelled');
    expect(embedded).toBe(0);
  });
});

describe('slicing changes nothing', () => {
  const x = noise(30, 7);
  const live = new AbortController().signal;

  it('spectrograms and segment powers equal one call’s, bit for bit', async () => {
    const sliced = abortableRunner(runner, live);
    for (const [spec, block] of [
      [glideSpec(), frameSignal(Float64Array.from(x), 1024, 240)],
      [pulseSpec(), centredFrames(x, 2048, 160)],
    ] as const) {
      expect(block.count).toBeGreaterThan(4096);
      const whole = await runner.spectrogram(spec, block);
      const parts = await sliced.spectrogram(spec, block);
      expect(parts.frames).toBe(whole.frames);
      expect(Buffer.from(parts.data.buffer).equals(Buffer.from(whole.data.buffer))).toBe(true);
    }
    const n = 1024;
    const count = 9000;
    const segments = x.subarray(0, count * n);
    const whole = await runner.segmentPower(segments, count, n);
    const parts = await sliced.segmentPower(segments, count, n);
    expect(Buffer.from(parts.power.buffer).equals(Buffer.from(whole.power.buffer))).toBe(true);
  });

  it('the sliced resampler gives the same samples', async () => {
    for (const rate of [22_050, 32_000] as const) {
      const whole = resampleFrom48k(x, rate);
      const parts = await resampleFrom48kAbortable(x, rate, live);
      expect(Buffer.from(parts.buffer).equals(Buffer.from(whole.buffer))).toBe(true);
    }
  });

  it('an aborted signal stops the runner at its next slice', async () => {
    const controller = new AbortController();
    controller.abort();
    const sliced = abortableRunner(runner, controller.signal);
    await expect(sliced.spectrogram(pulseSpec(), centredFrames(x, 2048, 480))).rejects.toBeDefined();
  });
});
