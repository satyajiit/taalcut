// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S7: a run named after a detector holds only clips that detector decided. A TransNetV2 run with a clip that
 * fell back to scdet is misattributed; runs from before IX2-S7 record no decider and pass; a stored library
 * promises none.
 */
import { describe, expect, it } from 'vitest';
import { decidedBy, misattributedClips, promisedDecider } from '../../src/shots/decider';
import type { ShotPredictions } from '../../src/shots/schema';

const run = (detector: string, deciders: (('model' | 'scdet') | undefined)[]): ShotPredictions => ({
  detector,
  clips: deciders.map((decider, i) => ({
    file: `clip-${i}.mp4`,
    ...(decider ? { detector: decider } : {}),
    boundaries: [],
  })),
});

describe('which detector decided', () => {
  it('reads the promise from the run’s name', () => {
    expect(
      ['transnetv2', 'transnetv2-inline', 'transnetv2@15fps', 'scdet+confirm', 'stored:/b/lib.sqlite'].map(
        promisedDecider,
      ),
    ).toEqual(['model', 'model', 'model', 'scdet', undefined]);
  });

  it('names the clips another detector decided, and counts every decider', () => {
    const fellBack = run('transnetv2', ['model', 'scdet', undefined]);
    expect(misattributedClips(fellBack)).toEqual(['clip-1.mp4 (scdet)']);
    expect(decidedBy(fellBack)).toEqual({ model: 1, scdet: 1 });
    expect(misattributedClips(run('scdet+confirm', ['scdet', 'scdet']))).toEqual([]);
    expect(misattributedClips(run('transnetv2', [undefined, undefined]))).toEqual([]);
    expect(misattributedClips(run('stored:/lib.sqlite', ['model', 'scdet']))).toEqual([]);
  });
});
