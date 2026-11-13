// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-D1: scripted clips (fades-v1) plan exactly what their script says, with the labels the shot eval reads, and
 * draw fades through black, cuts to black and low-key shots; ix-v1 plans and draws exactly what it did before
 * scripts existed (its spec hash and every plan and graph pinned), so its generated footage stays valid.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { specHash } from '../src/manifest';
import { planClip, plannedSeconds } from '../src/plan';
import { FADES_V1 } from '../src/sets/fades-v1';
import { footageSet } from '../src/sets/index';
import { IX_V1 } from '../src/sets/ix-v1';
import type { ClipSpec } from '../src/sets/types';
import { videoGraph } from '../src/video/graph';
import { DARK_FILTER, throughBlack } from '../src/video/through-black';

const byFile = (file: string): ClipSpec => {
  const found = FADES_V1.clips.find((clip) => clip.file === file);
  if (found === undefined) throw new Error(file);
  return found;
};

describe('ix-v1 before and after scripts', () => {
  it('keeps its spec hash, plans and graphs', () => {
    expect(specHash(IX_V1)).toBe('0a585da926f259f2d4a3510d2fa82603b7fd29ca6888b375ce65a51edcf878dd');
    const hash = createHash('sha256');
    for (const clip of IX_V1.clips) {
      const plan = planClip(IX_V1, clip);
      hash.update(JSON.stringify({ plan, g: videoGraph(plan, '/work') }));
    }
    expect(hash.digest('hex')).toBe('969f9c107994dcc20b3a857e2d6596ac046f44d2228a4e524e3d49b0fc8470d1');
  });
});

describe('fades-v1', () => {
  it('is listed, its clips add up and it holds every case the lane asked for', () => {
    expect(footageSet('fades-v1')).toBe(FADES_V1);
    for (const clip of FADES_V1.clips) expect(plannedSeconds(planClip(FADES_V1, clip))).toBe(clip.seconds);
    const cuts = FADES_V1.clips.flatMap((clip) => planClip(FADES_V1, clip).cuts);
    expect(cuts.filter((c) => c.kind === 'fade')).toHaveLength(10);
    expect(cuts.filter((c) => c.kind === 'dissolve')).toHaveLength(3);
    expect(cuts.filter((c) => c.kind === 'cut')).toHaveLength(10);
    expect(new Set(FADES_V1.clips.map((clip) => clip.fps))).toEqual(new Set([30, 60]));
    expect(FADES_V1.clips.every((clip) => clip.codec === 'h264')).toBe(true);
  });

  it('labels a fade from its fade out to its fade in, and a cut to black and back as two cuts', () => {
    expect(planClip(FADES_V1, byFile('fades-hold-30.mp4')).cuts).toEqual([
      { at: 3.5, kind: 'fade', seconds: 1.5 },
      { at: 9.5, kind: 'cut', seconds: 0 },
      { at: 12.5, kind: 'fade', seconds: 3 },
      { at: 18.5, kind: 'dissolve', seconds: 1 },
      { at: 23, kind: 'fade', seconds: 1 },
    ]);
    const black = planClip(FADES_V1, byFile('black-cuts-30.mp4'));
    expect(black.cuts).toEqual([
      { at: 4, kind: 'cut', seconds: 0 },
      { at: 5, kind: 'cut', seconds: 0 },
      { at: 9, kind: 'cut', seconds: 0 },
      { at: 9.6, kind: 'cut', seconds: 0 },
      { at: 13.6, kind: 'fade', seconds: 2 },
      { at: 18.6, kind: 'fade', seconds: 1.8 },
    ]);
    expect(black.shots.map((shot) => shot.startsAt)).toEqual([0, 5, 9.6, 14.6, 20.4]);
  });

  it('marks the dark shots and labels nothing inside them', () => {
    const plan = planClip(FADES_V1, byFile('dark-30.mp4'));
    expect(plan.shots.map((shot) => shot.dark === true)).toEqual([false, true, false, true, false]);
    expect(plan.cuts.map((cut) => cut.at)).toEqual([4, 12, 15, 21]);
  });

  it('refuses a transition longer than its shots', () => {
    const bad: ClipSpec = {
      ...byFile('fades-hold-30.mp4'),
      script: [
        { look: 'pattern', seconds: 1 },
        { look: 'fractal', seconds: 3, entry: { kind: 'fade', out: 2, hold: 0, in: 1 } },
      ],
    };
    expect(() => planClip(FADES_V1, bad)).toThrow(/fade into a fractal shot doesn't fit/);
  });
});

describe('drawing through black', () => {
  const picture = { width: 1280, height: 720, fps: 30 };
  const join = { before: '[join1]', length: 9, next: '[shot2]', index: 2, picture };

  it('fades the clip so far out, holds clean black and fades the next shot in', () => {
    expect(throughBlack({ ...join, fade: { out: 0.5, hold: 0.5, in: 1 } }, '[join2]')).toEqual([
      '[join1]fade=t=out:st=8.5:d=0.5[fadeout2]',
      '[shot2]fade=t=in:st=0:d=1[fadein2]',
      'color=c=black:s=1280x720:r=30:d=0.5,format=yuv420p,setsar=1,settb=AVTB[black2]',
      '[fadeout2][black2][fadein2]concat=n=3:v=1:a=0[join2]',
    ]);
  });

  it('joins a fade with no hold directly, and a cut to black and back without fades', () => {
    expect(throughBlack({ ...join, fade: { out: 2, hold: 0, in: 2 } }, '[join2]')).toEqual([
      '[join1]fade=t=out:st=7:d=2[fadeout2]',
      '[shot2]fade=t=in:st=0:d=2[fadein2]',
      '[fadeout2][fadein2]concat=n=2:v=1:a=0[join2]',
    ]);
    expect(throughBlack({ ...join, fade: { out: 0, hold: 1, in: 0 } }, '[join2]')).toEqual([
      'color=c=black:s=1280x720:r=30:d=1,format=yuv420p,setsar=1,settb=AVTB[black2]',
      '[join1][black2][shot2]concat=n=3:v=1:a=0[join2]',
    ]);
  });

  it('turns a dark shot low-key after its grain', () => {
    const graph = videoGraph(planClip(FADES_V1, byFile('dark-30.mp4')), '/work').filter;
    expect(graph.split(';').filter((chain) => chain.includes(DARK_FILTER))).toHaveLength(2);
    expect(graph).toMatch(/all_seed=\d+,geq=lum=/);
  });
});
