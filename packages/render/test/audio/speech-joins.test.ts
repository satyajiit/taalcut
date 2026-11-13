// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Which cuts get a speech join (P3-V9), and what the join does to the mix's segments. */
import { describe, expect, it } from 'vitest';
import { FrameRate, newId, RationalTime } from '@taalcut/core';
import { mixFilterGraph, planAudioMix, type AudioSourceMap } from '../../src/audio/mix-plan';
import { SPEECH_JOIN_MS, speechJoins } from '../../src/audio/speech-joins';
import { planOf } from './helpers';

const take = newId<'Asset'>();
const half = (SPEECH_JOIN_MS / 2 / 1000) * 48_000;
const sources: AudioSourceMap = {
  clip: () => ({ path: 'take.wav', offset: RationalTime.of(0, FrameRate.of(48_000)) }),
};

/** Sources at each clip's own in-point, as the sound stage hands them in. */
function sourcesFor(plan: ReturnType<typeof planOf>): AudioSourceMap {
  return {
    clip: (id) => {
      const clip = plan.audio.find((candidate) => candidate.id === id);
      return clip ? { path: 'take.wav', offset: clip.sourceIn } : undefined;
    },
  };
}

describe('speechJoins', () => {
  it('joins a cut between two pieces of one take whose source ranges do not touch', () => {
    const plan = planOf({
      items: [
        { frames: 30, sourceStart: 30, assetId: take },
        { frames: 30, sourceStart: 120, assetId: take },
      ],
    });
    const [a, b] = plan.audio;
    expect(speechJoins(plan)).toEqual([{ from: a!.id, to: b!.id, cutFrame: 30 }]);
  });

  it('leaves contiguous pieces, other takes and transitions alone', () => {
    const contiguous = planOf({
      items: [
        { frames: 30, sourceStart: 30, assetId: take },
        { frames: 30, sourceStart: 60, assetId: take },
      ],
    });
    const otherTakes = planOf({ items: [{ frames: 30 }, { frames: 30 }] });
    const transition = planOf({
      items: [
        { frames: 30, sourceStart: 30, assetId: take },
        {
          frames: 30,
          sourceStart: 120,
          assetId: take,
          transition: { kind: 'dissolve', inFrames: 4, outFrames: 4 },
        },
      ],
    });
    for (const plan of [contiguous, otherTakes, transition]) expect(speechJoins(plan)).toEqual([]);
  });

  it('runs the outgoing piece 6 ms on and starts the incoming one 6 ms early, with 12 ms qsin fades', () => {
    const plan = planOf({
      items: [
        { frames: 30, sourceStart: 30, assetId: take },
        { frames: 30, sourceStart: 120, assetId: take },
      ],
    });
    const mix = planAudioMix(plan, sourcesFor(plan));
    if (!mix.ok) throw new Error(mix.error.code);
    const [a, b] = mix.value.segments;
    expect(a).toMatchObject({
      startSample: 0,
      inSample: 48_000,
      samples: 48_000 + half,
      fadeOutSamples: 2 * half,
    });
    expect(b).toMatchObject({
      startSample: 48_000 - half,
      inSample: 192_000 - half,
      samples: 48_000 + half,
      fadeInSamples: 2 * half,
    });
    // Centred on the cut: the fades overlap exactly on [cut − 6 ms, cut + 6 ms).
    expect(a!.startSample + a!.samples - a!.fadeOutSamples).toBe(b!.startSample);
    expect(mix.value.totalSamples).toBe(96_000);
    const graph = mixFilterGraph(mix.value);
    expect(graph).toContain(`afade=t=out:ss=${48_000 - half}:ns=${2 * half}:curve=qsin`);
    expect(graph).toContain(`afade=t=in:ss=0:ns=${2 * half}:curve=qsin`);
    expect(graph).toContain(`adelay=delays=${48_000 - half}S:all=1`);
  });

  it('shortens the overlap when the incoming piece starts at the file’s first sample', () => {
    const plan = planOf({
      items: [
        { frames: 30, sourceStart: 30, assetId: take },
        { frames: 30, sourceStart: 0, assetId: take },
      ],
    });
    const mix = planAudioMix(plan, sources);
    if (!mix.ok) throw new Error(mix.error.code);
    // `sources` puts every clip at file time 0, so the incoming piece has no source before it.
    expect(mix.value.segments.map((segment) => segment.fadeInSamples + segment.fadeOutSamples)).toEqual([
      0, 0,
    ]);
  });
});
