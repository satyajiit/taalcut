// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-ACC: an overlay is text that persists, sits still on the frame and isn't part of the scene. Signs, shirts
 * and billboards are dropped; text the rules can't settle is kept with a doubt. Made-up text, boxes and cuts.
 */
import { describe, expect, it } from 'vitest';
import { FrameRates, newId, RationalTime, type TextOverlay } from '@taalcut/core';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import type { PixelEvidence } from '../src/breakdown/text-motion';
import {
  cutByPerson,
  judgeText,
  quadTilt,
  weighText,
  type TextEvidence,
  type WeighOptions,
} from '../src/breakdown/text-scene';

const rate = FrameRates.fps30;
const config = BREAKDOWN_CONFIG.textScene;
const TOTAL = 360;
/** A long first shot, then one shot a beat. */
const CUTS = [150, 170, 190, 205, 220, 240, 262, 280];

function overlay(
  text: string,
  start: number,
  end: number,
  box: TextOverlay['box'],
  confidence = 1,
): TextOverlay {
  return {
    id: newId<'TextOverlay'>(),
    text,
    role: 'label',
    start: RationalTime.of(start, rate),
    duration: RationalTime.of(end - start, rate),
    slotId: null,
    box,
    appearance: { size: box.height * 0.7, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'label',
    reveal: 'none',
    language: null,
    confidence,
  };
}

const judge = (overlays: TextOverlay[], evidence: (TextEvidence | undefined)[] = []) =>
  judgeText(overlays, evidence, CUTS, TOTAL, rate, config);
const still = (samples: number): TextEvidence => ({ samples, drift: 0.1 });

describe('judgeText', () => {
  it('keeps chat bubbles that pop in and out in the middle of a shot', () => {
    const question = overlay('Where to next?', 12, 118, { x: 0.3, y: 0.26, width: 0.15, height: 0.04 });
    const reply = overlay('Soon...', 90, 118, { x: 0.32, y: 0.37, width: 0.08, height: 0.04 });
    expect(judge([question, reply], [still(17), still(5)])).toEqual(['overlay', 'overlay']);
  });

  it('drops a sign cut off by the frame’s edge, and vertical lettering on a door', () => {
    const sign = overlay('CENTRAL STATION', 0, 60, { x: 0.78, y: 0, width: 0.2, height: 0.17 });
    const door = overlay('出口案内', 170, 186, { x: 0.84, y: 0.1, width: 0.05, height: 0.5 });
    expect(judge([sign, door], [still(8), still(2)])).toEqual(['scene', 'scene']);
  });

  it('drops text that moves with the camera, and text that flickers for a few frames', () => {
    const shirt = overlay('ATHLETICS', 115, 145, { x: 0.45, y: 0.62, width: 0.1, height: 0.05 });
    const flicker = overlay('OPEN', 130, 133, { x: 0.54, y: 0.68, width: 0.08, height: 0.12 });
    expect(judge([shirt, flicker], [{ samples: 5, drift: 1.4 }, still(1)])).toEqual(['scene', 'scene']);
  });

  it('drops a street of billboards that live exactly as long as their shot', () => {
    const boards = ['COLA', 'FRESH', 'NOODLE', 'GLOW'].map((word, i) =>
      overlay(word, 240, 262, { x: 0.1 + i * 0.15, y: 0.2, width: 0.08, height: 0.04 }),
    );
    expect(
      judge(
        boards,
        boards.map(() => still(3)),
      ),
    ).toEqual(['scene', 'scene', 'scene', 'scene']);
  });

  it('keeps still text that crosses a cut: it was laid over the edit', () => {
    const handle = overlay('@traveller', 130, 200, { x: 0.4, y: 0.88, width: 0.2, height: 0.04 });
    expect(judge([handle], [still(15)])).toEqual(['overlay']);
  });

  it('marks what it can’t settle: still text that starts with its shot, or a doubtful reading', () => {
    const title = overlay('DAY ONE', 190, 205, { x: 0.3, y: 0.4, width: 0.4, height: 0.1 });
    const faint = overlay('Platform 3', 50, 80, { x: 0.82, y: 0.12, width: 0.14, height: 0.11 }, 0.5);
    expect(judge([title, faint], [still(3), still(4)])).toEqual(['maybeScene', 'maybeScene']);
  });
});

/** FIX-SIGN: the fused record. Made-up readings, boxes and pixel evidence. */
describe('weighText', () => {
  const weigh = (
    overlays: TextOverlay[],
    evidence: (TextEvidence | undefined)[] = [],
    extra: Partial<WeighOptions> = {},
  ) => weighText(overlays, evidence, { cuts: CUTS, total: TOTAL, rate, config, ...extra });
  const fixed: PixelEvidence = {
    pairs: 7,
    withPicture: 0,
    fixedOnPicture: 1,
    ownMove: 0,
    covered: 0,
    fill: 0.95,
    bounded: true,
    contrast: 240,
  };
  const drifting: PixelEvidence = { ...fixed, withPicture: 0.7, fixedOnPicture: 0, fill: 0.8, contrast: 105 };

  it('drops a station sign read three ways at one place, each popping in and out mid-shot', () => {
    const box = (dx: number) => ({ x: 0.85 + dx, y: 0.46, width: 0.04, height: 0.05 });
    const signs = [
      overlay('TR Line', 2, 30, box(0)),
      overlay('19 Line', 48, 78, box(0.002)),
      overlay('VR Line', 81, 126, box(-0.004)),
    ];
    // Without pixels the readings alone settle it: misread, and the same place comes back after a gap.
    expect(
      weigh(
        signs,
        signs.map(() => still(4)),
      ).map((j) => j.kind),
    ).toEqual(['scene', 'scene', 'scene']);
    // With pixels, the sign drifts with the picture behind it.
    const judged = weigh(
      signs,
      signs.map(() => still(4)),
      { pixels: signs.map(() => drifting) },
    );
    expect(judged.map((j) => j.kind)).toEqual(['scene', 'scene', 'scene']);
    expect(judged[1]!.signals.withPicture).toBeGreaterThan(2);
    expect(new Set(judged.map((j) => j.site)).size).toBe(1);
  });

  it('keeps a chat bubble that stays put on a still fill while the picture moves, with each signal recorded', () => {
    const bubble = overlay('Where to next?', 12, 118, { x: 0.3, y: 0.26, width: 0.15, height: 0.04 });
    const [judged] = weigh([bubble], [still(17)], { pixels: [fixed] });
    expect(judged).toMatchObject({ kind: 'composited', lean: null });
    expect(judged!.signals).toMatchObject({ fixedOnPicture: -4, shape: -2.5, midShot: -1.2 });
    expect(judged!.score).toBeCloseTo(Object.values(judged!.signals).reduce((a, b) => a + b, 0));
    expect(judged!.sceneProbability).toBeLessThan(0.01);
  });

  it('leans composited for a bubble shape it is unsure of, and scene when something passes in front', () => {
    // Lives exactly as long as its shot beside lines of other sizes, on a still fill, the camera held still:
    // unsure, but a bubble's shape.
    const pill = overlay('Soon...', 150, 170, { x: 0.32, y: 0.37, width: 0.08, height: 0.04 });
    const stillFill: PixelEvidence = { ...fixed, fixedOnPicture: 0 };
    const beside = { samples: 3, drift: 0, block: 2 };
    expect(weigh([pill], [beside], { pixels: [stillFill] })[0]).toMatchObject({
      kind: 'composited',
      lean: 'composited',
    });
    // The same, its words cut from one side in some frames: something stood in front of it.
    const hidden: PixelEvidence = { ...stillFill, covered: 0.45 };
    expect(weigh([pill], [beside], { pixels: [hidden] })[0]).toMatchObject({ kind: 'scene', lean: 'scene' });
  });

  it('reads a sign at an angle from its quad, and never takes a fill round tilted words for a bubble', () => {
    expect(
      quadTilt(
        [
          { x: 0, y: 0 },
          { x: 0.2, y: 0 },
          { x: 0.2, y: 0.05 },
          { x: 0, y: 0.05 },
        ],
        16 / 9,
      ),
    ).toBe(0);
    const leaning = [
      { x: 0.5, y: 0.3 },
      { x: 0.7, y: 0.34 },
      { x: 0.7, y: 0.38 },
      { x: 0.5, y: 0.36 },
    ] as const;
    expect(quadTilt(leaning, 16 / 9)).toBe(1);
    const shop = overlay('NOODLE BAR', 0, 150, { x: 0.5, y: 0.3, width: 0.2, height: 0.08 });
    const [judged] = weigh([shop], [{ samples: 20, drift: 0, quad: leaning }], {
      aspect: 16 / 9,
      pixels: [{ ...fixed, fixedOnPicture: 0 }],
    });
    expect(judged).toMatchObject({ kind: 'scene' });
    expect(judged!.signals.shape).toBeUndefined();
  });

  it('takes a person of the reel standing in front of the words, cutting them, as the scene', () => {
    const sign = overlay('EXIT 4', 30, 100, { x: 0.6, y: 0.4, width: 0.1, height: 0.05 });
    const samples = [40, 60, 80].map((frame) => ({
      t: RationalTime.of(frame, rate),
      heads: [],
      people: [{ box: { x: 0.45, y: 0.2, width: 0.2, height: 0.8 }, confidence: 0.9 }],
    }));
    const subjects = { version: 1 as const, detector: 'vision' as const, hz: 4, samples };
    expect(cutByPerson(sign.box, { start: 30, end: 100 }, subjects, rate)).toBe(true);
    // Words placed beside the person, not cut by them, are not.
    expect(
      cutByPerson({ x: 0.7, y: 0.4, width: 0.1, height: 0.05 }, { start: 30, end: 100 }, subjects, rate),
    ).toBe(false);
    expect(weigh([sign], [still(9)], { subjects })[0]!.signals.behindPerson).toBe(2);
  });
});
