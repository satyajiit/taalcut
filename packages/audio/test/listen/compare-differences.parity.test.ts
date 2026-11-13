// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A3: how B differs from A in measured terms (earshot `ab`'s `differences`, what `audio.compare` says in
 * words), on upstream's 10 A/B pairs (tools/earshot-parity cli/ab.json): the comparable measurements
 * (compare-features.ts over F6's light measure) and the terms they give, in upstream's order. No model: CLAP's
 * cosine and the query's closer side are F5's (describe-parity) and the tool's end-to-end test's.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { cli, loadClip } from '../../../../tools/earshot-parity/fixtures.mjs';
import { differences } from '../../src/listen/describe/compare';
import { compareFeatures } from '../../src/listen/describe/compare-features';
import { measureSound } from '../../src/listen/dsp/measure';
import type { ListenAudio } from '../../src/listen/dsp/pcm';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';

interface AbRun {
  readonly a_range: readonly [number | null, number | null];
  readonly b_range: readonly [number | null, number | null];
  readonly features: { readonly a: Record<string, number>; readonly b: Record<string, number> };
  readonly differences: readonly string[];
}

const runner = createSpectrogramRunner();
afterAll(() => runner.release());

function audioOf(id: string, range: readonly [number | null, number | null]): ListenAudio {
  const clip = loadClip(id);
  const [start, end] = range;
  const n = clip.channels[0]?.length ?? 0;
  const a = start === null ? 0 : Math.round(start * 48_000);
  const b = end === null ? n : Math.min(n, Math.round(end * 48_000));
  return { sampleRate: 48_000, channels: clip.channels.map((c) => c.subarray(a, b)) };
}

const TOL: Record<string, number> = { loudness_lufs: 0.1, peak_dbfs: 0.1, low_end_db: 0.1, length_s: 0.01 };

describe('compare: how B differs from A, on upstream’s 10 pairs', () => {
  const runs = Object.entries(cli<AbRun>('ab'));
  it('has the 10 pairs', () => expect(runs).toHaveLength(10));

  it.each(runs)('%s: the same measurements and the same terms', async (_id, run) => {
    const [a, b] = [run.argv[1], run.argv[2]].map((file) => (file ?? '').replace(/\.wav$/, ''));
    const sides = [audioOf(a ?? '', run.result.a_range), audioOf(b ?? '', run.result.b_range)] as const;
    const [fa, fb] = await Promise.all(
      sides.map(async (audio) => compareFeatures(await measureSound(audio, runner), audio)),
    );
    if (!fa || !fb) throw new Error('no features');
    for (const [side, ours] of [
      ['a', fa],
      ['b', fb],
    ] as const) {
      for (const [key, value] of Object.entries(run.result.features[side])) {
        const mine = (ours as Record<string, number | undefined>)[key];
        expect(mine, `${side}.${key}`).toBeDefined();
        expect(Math.abs((mine ?? 0) - value), `${side}.${key}: ${mine} vs ${value}`).toBeLessThanOrEqual(
          TOL[key] ?? Math.max(1, Math.abs(value) * 0.01),
        );
      }
    }
    expect(differences(fa, fb).keys).toEqual(run.result.differences);
  });
});
