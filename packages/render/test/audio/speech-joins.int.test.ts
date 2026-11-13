// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Speech joins with the bundled FFmpeg (P3-V9): a cut between two pieces of a sine sweep (one take, source
 * ranges apart) gets the 12 ms equal-power crossfade; the mix keeps its exact sample count, each piece stays
 * on its own samples away from the join, and the join's steepest step is under the uncut sweep's, where the
 * same cut without the join jumps.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { renderMix } from '../../src/audio/mix';
import { planAudioMix, type AudioSourceMap } from '../../src/audio/mix-plan';
import { SPEECH_JOIN_MS } from '../../src/audio/speech-joins';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { decodePcm, evalWav, planOf } from './helpers';

const media = await findTestMedia('render speech joins');
const half = (SPEECH_JOIN_MS / 2 / 1000) * 48_000;
/** 100 Hz to 2 kHz over 10 s: the instantaneous frequency (and so the slope) is known everywhere. */
const SWEEP = '0.5*sin(2*PI*(100*n/48000+95*(n/48000)*(n/48000)))';

/** The steepest sample-to-sample step in [from, to). */
function steepest(pcm: Float32Array, from = 0, to = pcm.length): number {
  let max = 0;
  for (let i = Math.max(1, from); i < to; i++) max = Math.max(max, Math.abs(pcm[i]! - pcm[i - 1]!));
  return max;
}

describe.skipIf(!media.binaries)('speech joins', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let sweep: string;
  let uncut: Float32Array;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('speech-joins');
    sweep = await evalWav(ctx, work.dir, 'sweep', SWEEP, 480_000);
    uncut = await decodePcm(ctx, sweep);
  });
  afterAll(() => work?.dispose());

  /**
   * Two 1 s pieces of the sweep: source 1.0–2.0 s (ending on a zero crossing), then 2.5–3.5 s (starting on a
   * trough), cut at render frame 30: a hard cut there jumps by the full amplitude.
   */
  async function render(sameTake: boolean, name: string) {
    const take = newId<'Asset'>();
    const plan = planOf({
      items: [
        { frames: 30, sourceStart: 30, ...(sameTake ? { assetId: take } : {}) },
        { frames: 30, sourceStart: 75, ...(sameTake ? { assetId: take } : {}) },
      ],
    });
    const sources: AudioSourceMap = {
      clip: (id) => {
        const clip = plan.audio.find((candidate) => candidate.id === id);
        return clip ? { path: sweep, offset: clip.sourceIn } : undefined;
      },
    };
    const mix = planAudioMix(plan, sources);
    if (!mix.ok) throw new Error(mix.error.code);
    const out = await renderMix(mix.value, ctx, { out: join(work.dir, `${name}.wav`) });
    if (!out.ok) throw new Error(`${out.error.code}: ${out.error.detail ?? ''}`);
    return { pcm: await decodePcm(ctx, out.value.path), mix: mix.value, plan };
  }

  it('crossfades the cut over 12 ms, exactly as long, each piece on its own samples', async () => {
    const { pcm, mix, plan } = await render(true, 'joined');
    expect(mix.segments.map((segment) => segment.fadeOutSamples + segment.fadeInSamples)).toEqual([
      2 * half,
      2 * half,
    ]);
    // Exact length: 60 frames at 30 fps.
    expect(pcm.length).toBe(96_000);
    // The picture still cuts on frame 30; outside the join each piece is its source, sample for sample.
    expect(plan.visuals.map((visual) => visual.cut.start)).toEqual([0, 30]);
    for (const at of [1000, 30_000, 48_000 - half - 10]) expect(pcm[at]!).toBeCloseTo(uncut[48_000 + at]!, 5);
    for (const at of [48_000 + half + 10, 60_000, 95_000])
      expect(pcm[at]!).toBeCloseTo(uncut[120_000 + at - 48_000]!, 5);
    // The join is no steeper than the sweep is anywhere.
    const join = steepest(pcm, 48_000 - half - 4, 48_000 + half + 4);
    const sweepMax = steepest(uncut);
    process.stdout.write(`[speech joins] join ${join.toFixed(4)} sweep ${sweepMax.toFixed(4)}\n`);
    expect(join).toBeLessThan(sweepMax);
  });

  it('the same cut between two takes is a hard cut, and jumps', async () => {
    const { pcm, mix } = await render(false, 'hard');
    expect(mix.segments.every((segment) => segment.fadeInSamples + segment.fadeOutSamples === 0)).toBe(true);
    expect(pcm.length).toBe(96_000);
    expect(steepest(pcm, 47_990, 48_010)).toBeGreaterThan(steepest(uncut));
  });
});
