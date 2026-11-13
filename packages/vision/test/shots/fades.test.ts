// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-D2: fades through black from the pass's own black runs, on synthetic pass documents. A fade is one boundary
 * of kind `fade` in the middle of its black frames, in place of whatever the detector put inside it (a model cut
 * in the black, a dissolve on a ramp, scdet's cuts at both ends). A cut to black and back stays two cuts; a dark
 * scene drifting into black (or entered and left by a dissolve or a cut), black at either end of the asset and a
 * document from before mark nothing.
 */
import { describe, expect, it } from 'vitest';
import { blackRun, runFrames } from '../../src/shots/black-sides';
import { fadesThroughBlack, markFades, withFades } from '../../src/shots/fades';
import type { ShotCut } from '../../src/shots/shot-list';
import { EVERY, fadeLuma, FPS, passDoc } from './fade-pass';

const grid = { fps: FPS, frameCount: 300 };
const model = (frame: number, extra: Partial<ShotCut> = {}): ShotCut => ({
  frame,
  score: 0.9,
  method: 'model',
  kind: 'cut',
  ...extra,
});
const mark = (cuts: readonly ShotCut[], doc: ReturnType<typeof passDoc>) =>
  markFades(cuts, doc, { ...grid, method: 'model' });

// Lit until 90, out over 15 frames to black at 105, held 15 frames, in over 15: black by blackdetect 103–121.
const halfHold = passDoc({
  frames: 300,
  luma: fadeLuma({ black: 105, hold: 15, out: 15, inn: 15 }),
  blackRuns: [[103, 121]],
});

describe('black runs on the grid', () => {
  it('reads blackdetect’s seconds as the black frames, the end being the first frame after', () => {
    expect(runFrames({ startSec: 103 / 30, endSec: 122 / 30 }, 30)).toEqual({ from: 103, to: 121 });
    expect(runFrames({ startSec: 1.233333, endSec: 1.266667 }, 30)).toEqual({ from: 37, to: 37 });
    expect(runFrames({ startSec: 2, endSec: 2 }, 30)).toBeUndefined();
  });

  it('walks each ramp out to the lit picture, and stops at a hard change', () => {
    const run = blackRun(halfHold, { from: 103, to: 121 }, 8);
    expect(run.before).toEqual({ hard: false, far: 90, luma: 100 });
    expect(run.after).toEqual({ hard: false, far: 135, luma: 100 });
    // A cut at 95 inside the fade-out: the ramp ends after it.
    const cutIn = passDoc({
      frames: 300,
      luma: fadeLuma({ black: 105, hold: 15, out: 15, inn: 15 }),
      hard: [95],
    });
    expect(blackRun(cutIn, { from: 103, to: 121 }, 8).before.far).toBe(96);
  });

  it('calls a side hard when scdet scores its edge frame as a cut', () => {
    const doc = passDoc({ frames: 300, luma: () => 100, hard: [100, 130] });
    const run = blackRun(doc, { from: 100, to: 129 }, 8);
    expect(run.before).toEqual({ hard: true, far: 100, luma: 0 });
    expect(run.after).toEqual({ hard: true, far: 129, luma: 0 });
  });
});

describe('fades through black', () => {
  it('marks a fade out, a hold and a fade in as one boundary in the middle of the black', () => {
    const fades = fadesThroughBlack(halfHold, grid);
    expect(fades).toEqual([{ frame: 113, black: { from: 103, to: 121 }, span: { from: 90, to: 135 } }]);
    expect(mark([], halfHold)).toEqual([
      { frame: 113, score: 0, method: 'model', kind: 'fade', span: { from: 90, to: 135 } },
    ]);
  });

  it('takes the place of a model cut inside the black run: one boundary', () => {
    expect(mark([model(40), model(122, { score: 0.7 }), model(200)], halfHold)).toEqual([
      model(40),
      { frame: 113, score: 0.7, method: 'model', kind: 'fade', span: { from: 90, to: 135 } },
      model(200),
    ]);
  });

  it('takes the place of gradual transitions the model saw on the ramps, and of scdet’s cuts at both ends', () => {
    const ramps = [
      model(96, { kind: 'dissolve', span: { from: 91, to: 101 }, score: 0.6 }),
      model(128, { kind: 'dissolve', span: { from: 124, to: 133 }, score: 0.8 }),
    ];
    expect(mark(ramps, halfHold).map((c) => [c.frame, c.kind, c.score])).toEqual([[113, 'fade', 0.8]]);
    const scdet: ShotCut[] = [
      { frame: 104, score: 9, method: 'both' },
      { frame: 122, score: 11, method: 'both' },
    ];
    expect(markFades(scdet, halfHold, { ...grid, method: 'scdet' })).toEqual([
      { frame: 113, score: 11, method: 'scdet', kind: 'fade', span: { from: 90, to: 135 } },
    ]);
  });

  it('keeps a cut a sample or more past the ramp', () => {
    const cuts = [model(90 - EVERY - 1), model(135 + EVERY + 2)];
    expect(mark(cuts, halfHold).map((c) => c.frame)).toEqual([86, 113, 140]);
  });

  it('marks a fade with no hold and a slow one alike', () => {
    const noHold = passDoc({
      frames: 300,
      luma: fadeLuma({ black: 150, hold: 0, out: 60, inn: 60 }),
      blackRuns: [[145, 155]],
    });
    expect(fadesThroughBlack(noHold, grid)).toEqual([
      { frame: 151, black: { from: 145, to: 155 }, span: { from: 90, to: 210 } },
    ]);
    // Its bottom is short: a fade even when no sample there is flat.
    const traced = passDoc({
      frames: 300,
      luma: fadeLuma({ black: 150, hold: 0, out: 60, inn: 60 }),
      std: () => 4,
      blackRuns: [[145, 155]],
    });
    expect(fadesThroughBlack(traced, grid).map((f) => f.frame)).toEqual([151]);
  });

  it('marks a hard cut into black that fades in, and a fade out that cuts out of black', () => {
    const cutThenIn = passDoc({
      frames: 300,
      luma: (f) => (f < 100 ? 100 : f < 130 ? 0 : Math.min(100, ((f - 129) * 100) / 15)),
      hard: [100],
      blackRuns: [[100, 131]],
    });
    expect(mark([model(100)], cutThenIn)).toEqual([
      { frame: 116, score: 0.9, method: 'model', kind: 'fade', span: { from: 100, to: 144 } },
    ]);
    const outThenCut = passDoc({
      frames: 300,
      luma: (f) => (f < 85 ? 100 : f < 100 ? ((100 - f) * 100) / 15 : f < 130 ? 0 : 100),
      hard: [130],
      blackRuns: [[98, 129]],
    });
    expect(mark([model(130)], outThenCut).map((c) => [c.frame, c.kind])).toEqual([[114, 'fade']]);
  });

  it('leaves a cut to black and back as the model’s two cuts', () => {
    const interstitial = passDoc({
      frames: 300,
      luma: (f) => (f >= 100 && f < 130 ? 0 : 100),
      hard: [100, 130],
      blackRuns: [[100, 129]],
    });
    expect(fadesThroughBlack(interstitial, grid)).toEqual([]);
    expect(mark([model(100), model(130)], interstitial)).toEqual([model(100), model(130)]);
  });

  it('marks nothing in a dark scene that drifts in and out of black', () => {
    // Mean luma 18–30, under blackdetect's rule now and then: no ramp ever reaches a lit picture.
    const dark = passDoc({
      frames: 300,
      luma: (f) => 24 + 6 * Math.sin(f / 20),
      blackRuns: [
        [80, 95],
        [205, 220],
      ],
    });
    expect(fadesThroughBlack(dark, grid)).toEqual([]);
    expect(mark([], dark)).toEqual([]);
  });

  it('leaves a dark scene entered by a dissolve and left by a cut, or by dissolves, to the detector', () => {
    // Lit until 85, a dissolve to a low-key picture by 100 (black by blackdetect's rule, but with structure: a
    // spread of 3 levels), held until a cut at 200, or a dissolve out of it from 200 to 215.
    const darkLuma = (f: number) => (f < 85 ? 100 : f < 100 ? 6 + ((100 - f) * 94) / 15 : 6);
    const spread = (f: number) => (f < 85 ? 30 : 3);
    const cutOut = passDoc({
      frames: 300,
      luma: (f) => (f >= 200 ? 100 : darkLuma(f)),
      std: (f) => (f >= 200 ? 30 : spread(f)),
      hard: [200],
      blackRuns: [[98, 199]],
    });
    const found = [model(92, { kind: 'dissolve', span: { from: 85, to: 99 } }), model(200)];
    expect(fadesThroughBlack(cutOut, grid)).toEqual([]);
    expect(mark(found, cutOut)).toEqual(found);
    const dissolves = passDoc({
      frames: 300,
      luma: (f) => (f >= 215 ? 100 : f >= 200 ? 6 + ((f - 200) * 94) / 15 : darkLuma(f)),
      std: (f) => (f >= 215 ? 30 : spread(f)),
      blackRuns: [[98, 201]],
    });
    expect(fadesThroughBlack(dissolves, grid)).toEqual([]);
  });

  it('marks nothing where a dark scene brightens until it is lit: no evidence of another shot', () => {
    // Black 100–129 (its edges drift under scdet's cut score), dim before, a lamp coming on after.
    const lamp = passDoc({
      frames: 300,
      luma: (f) => (f < 100 ? 24 : f < 130 ? 0 : Math.min(120, (f - 129) * 4)),
      blackRuns: [[100, 129]],
    });
    expect(fadesThroughBlack(lamp, grid)).toEqual([]);
  });

  it('marks no boundary for black at the start or the end of the asset', () => {
    const ends = passDoc({
      frames: 300,
      luma: (f) =>
        f < 20 || f >= 280 ? 0 : f < 35 ? ((f - 19) * 100) / 15 : f >= 265 ? ((280 - f) * 100) / 15 : 100,
      blackRuns: [
        [0, 21],
        [278, 299],
      ],
    });
    expect(fadesThroughBlack(ends, grid)).toEqual([]);
  });

  it('joins a black run broken by a frame over the threshold into one fade', () => {
    const broken = passDoc({
      frames: 300,
      luma: fadeLuma({ black: 105, hold: 15, out: 15, inn: 15 }),
      blackRuns: [
        [103, 110],
        [112, 121],
      ],
    });
    expect(fadesThroughBlack(broken, grid)).toEqual([
      { frame: 113, black: { from: 103, to: 121 }, span: { from: 90, to: 135 } },
    ]);
  });

  it('changes nothing on a document from before (no black runs measured)', () => {
    const before = passDoc({ frames: 300, luma: fadeLuma({ black: 105, hold: 15, out: 15, inn: 15 }) });
    const cuts = [model(40), model(122)];
    expect(mark(cuts, before)).toEqual(cuts);
  });

  it('places each fade among the boundaries in frame order', () => {
    const fade = { frame: 113, black: { from: 103, to: 121 }, span: { from: 90, to: 135 } };
    const out = withFades([model(200), model(10)], [fade], { reach: EVERY, method: 'model' });
    expect(out.map((c) => c.frame)).toEqual([10, 113, 200]);
  });
});
