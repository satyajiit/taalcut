// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-SIGN's bar on made-up reels (helpers/scene-text-world.ts): ten kinds of shot, each drawn six ways (place,
 * size, speed, words), read by the breakdown's own text stage (OCR tracking, pixels, the fused judge). At least 95%
 * of the readings are judged right, and no added overlay is ever judged the scene's.
 */
import { describe, expect, it } from 'vitest';
import { FrameRates, newId, type Box } from '@taalcut/core';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import type { StepContext } from '../src/breakdown/steps';
import { readText } from '../src/breakdown/steps';
import { judgeReadText, type DraftTextRegion } from '../src/breakdown/text-judge';
import {
  fixtureAnalysers,
  wordsSize,
  type AddedText,
  type Fixture,
  type SceneText,
  type Shot,
  type Walker,
} from './helpers/scene-text-world';

const WORDS = ['OPEN DAILY', 'Day one', 'how was it?', 'CAFE 24', 'Night out', 'NO PARKING'];
const still: Shot['camera'] = () => ({ x: 0, y: 0 });
const pan =
  (vx: number, vy = 0): Shot['camera'] =>
  (frame) => ({ x: vx * frame, y: vy * frame });
const handheld =
  (seed: number): Shot['camera'] =>
  (frame) => ({
    x: 3 * Math.sin(frame / 9 + seed) + 2 * Math.sin(frame / 4.3),
    y: 2 * Math.cos(frame / 7 + seed),
  });
const WHITE = [245, 245, 245] as const;
const DARK = [24, 24, 28] as const;

interface Case {
  readonly fixture: Fixture;
  /** What each text is. */
  readonly expected: readonly ('composited' | 'scene')[];
}

const base = (
  name: string,
  seed: number,
  shots: Shot[],
  texts: (SceneText | AddedText)[],
  walkers: Walker[] = [],
) => ({
  name: `${name} #${seed}`,
  width: 640,
  height: 360,
  total: shots.at(-1)!.end,
  shots,
  texts,
  walkers,
  noise: 4,
});

/** The brief's eight kinds of shot and two harder ones, the `seed`th way. */
function cases(seed: number): Case[] {
  const words = WORDS[seed % WORDS.length]!;
  const other = WORDS[(seed + 3) % WORDS.length]!;
  const h = 16 + (seed % 3) * 4;
  const jitter = (seed * 37) % 60;
  return [
    {
      fixture: base(
        'sign text with a pan',
        seed,
        [{ start: 0, end: 120, seed, camera: pan(1.5 + (seed % 3) * 0.6, 0.3) }],
        [
          {
            kind: 'scene',
            text: words,
            at: { x: 180 + jitter, y: 120 },
            height: h,
            ink: WHITE,
            panel: DARK,
            shot: 0,
          },
        ],
      ),
      expected: ['scene'],
    },
    {
      fixture: base(
        'sign text, a still camera and a person walking in front',
        seed,
        [{ start: 0, end: 150, seed, camera: still }],
        [
          {
            kind: 'scene',
            text: words,
            at: { x: 260 + jitter, y: 140 },
            height: h,
            ink: DARK,
            panel: [200, 190, 60],
            shot: 0,
          },
        ],
        [
          {
            from: 30 + seed * 3,
            to: 120,
            x0: 60,
            x1: 600,
            y: 0,
            width: 80,
            height: 360,
            colour: [150, 100, 80],
          },
        ],
      ),
      expected: ['scene'],
    },
    {
      fixture: base(
        'an added title over a pan',
        seed,
        [{ start: 0, end: 120, seed, camera: pan(2 + (seed % 2), -0.4) }],
        [
          {
            kind: 'added',
            text: words,
            at: { x: 120 + jitter, y: 60 },
            height: h + 8,
            ink: WHITE,
            from: 8,
            to: 100,
          },
        ],
      ),
      expected: ['composited'],
    },
    {
      fixture: base(
        'an added title over a still shot',
        seed,
        [{ start: 0, end: 150, seed, camera: still }],
        [
          {
            kind: 'added',
            text: words,
            at: { x: 150 + jitter, y: 150 },
            height: h + 6,
            ink: WHITE,
            from: 12,
            to: 120,
          },
        ],
      ),
      expected: ['composited'],
    },
    {
      fixture: base(
        'a bubble entering mid-shot',
        seed,
        [{ start: 0, end: 160, seed, camera: handheld(seed) }],
        [
          {
            kind: 'added',
            text: other,
            at: { x: 120 + jitter, y: 80 },
            height: h,
            ink: DARK,
            fill: WHITE,
            from: 40 + seed * 2,
            to: 130,
          },
        ],
      ),
      expected: ['composited'],
    },
    {
      fixture: base(
        'a caption crossing a cut',
        seed,
        [
          { start: 0, end: 90, seed, camera: still },
          { start: 90, end: 180, seed: seed + 50, camera: pan(-1.5) },
        ],
        [
          {
            kind: 'added',
            text: other,
            at: { x: 160 + jitter, y: 300 },
            height: h,
            ink: WHITE,
            from: 50,
            to: 150,
          },
        ],
      ),
      expected: ['composited'],
    },
    {
      fixture: base(
        'a perspective-skewed shop sign',
        seed,
        [{ start: 0, end: 150, seed, camera: still }],
        [
          {
            kind: 'scene',
            text: other,
            at: { x: 230 + jitter, y: 100 },
            height: h + 4,
            ink: [250, 230, 120],
            panel: [120, 20, 30],
            skew: 0.7 + (seed % 3) * 0.15,
            shot: 0,
          },
        ],
      ),
      expected: ['scene'],
    },
    {
      fixture: base(
        'an added title over a still shot, a person walking behind it',
        seed,
        [{ start: 0, end: 150, seed, camera: still }],
        [
          {
            kind: 'added',
            text: other,
            at: { x: 200 + jitter, y: 160 },
            height: h + 4,
            ink: WHITE,
            from: 10,
            to: 125,
          },
        ],
        [{ from: 20, to: 140, x0: 40, x1: 600, y: 0, width: 90, height: 360, colour: [140, 90, 70] }],
      ),
      expected: ['composited'],
    },
    {
      fixture: base(
        'sign text with a handheld camera',
        seed,
        [{ start: 0, end: 150, seed, camera: handheld(seed + 2) }],
        [
          {
            kind: 'scene',
            text: other,
            at: { x: 380 + (jitter >> 1), y: 170 },
            height: h - 2,
            ink: WHITE,
            panel: DARK,
            shot: 0,
          },
        ],
      ),
      expected: ['scene'],
    },
    {
      fixture: base(
        'a flat lower third',
        seed,
        [{ start: 0, end: 150, seed, camera: handheld(seed + 1) }],
        [
          {
            kind: 'added',
            text: words,
            at: { x: 40 + (jitter >> 1), y: 290 },
            height: h,
            ink: WHITE,
            fill: [30, 60, 160],
            from: 30,
            to: 120,
          },
        ],
      ),
      expected: ['composited'],
    },
  ];
}

const rate = FrameRates.fps30;

/** The text a region is: the one whose box it overlaps at its first frame. */
function textOf(fixture: Fixture, region: DraftTextRegion): number {
  const frame = region.start;
  const shot = fixture.shots.findIndex((s) => frame >= s.start && frame < s.end);
  const camera = fixture.shots[Math.max(0, shot)]!.camera(frame);
  const overlap = (a: Box, b: Box) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const scores = fixture.texts.map((text) => {
    const size = wordsSize(text.text, text.height);
    const x = text.kind === 'scene' ? text.at.x - camera.x : text.at.x;
    const y = text.kind === 'scene' ? text.at.y - camera.y : text.at.y;
    const box = {
      x: x / fixture.width,
      y: y / fixture.height,
      width: size.width / fixture.width,
      height: size.height / fixture.height,
    };
    return overlap(box, region.box);
  });
  return scores.indexOf(Math.max(...scores));
}

async function judge(fixture: Fixture) {
  const analysers = fixtureAnalysers(fixture);
  const ctx = {
    path: '/fixture.mp4',
    dir: '/nonexistent/fixture',
    rate,
    total: fixture.total,
    analysers: { ...analysers, audio: {} },
    config: BREAKDOWN_CONFIG,
    signal: new AbortController().signal,
  } as unknown as StepContext;
  const read = await readText(ctx, { screenRecording: false, newId: () => newId<'TextOverlay'>() });
  if (!read.ok) throw new Error(read.error.code);
  const cuts = fixture.shots.slice(1).map((shot) => shot.start);
  return judgeReadText(ctx, read.value, { cuts, aspect: fixture.width / fixture.height, subjects: null });
}

describe('composited or scene, on made-up reels (FIX-SIGN)', () => {
  it(
    'judges at least 95% of the readings right and never judges an added overlay the scene’s',
    { timeout: 120_000 },
    async () => {
      let right = 0;
      let total = 0;
      const lost: string[] = [];
      const wrong: string[] = [];
      for (let seed = 0; seed < 6; seed++)
        for (const { fixture, expected } of cases(seed)) {
          const { regions } = await judge(fixture);
          // Every added text is read at least once.
          for (const [index, kind] of expected.entries())
            if (kind === 'composited' && !regions.some((region) => textOf(fixture, region) === index))
              lost.push(`${fixture.name}: never read`);
          for (const region of regions) {
            const want = expected[textOf(fixture, region)]!;
            total++;
            if (region.kind === want) right++;
            else
              wrong.push(
                `${fixture.name}: ${region.kind} (${region.score}) ${JSON.stringify(region.signals)}`,
              );
            if (want === 'composited' && region.kind === 'scene') lost.push(`${fixture.name}: dropped`);
          }
        }
      // The numbers FIX-SIGN reports, with what went wrong, in the message.
      const tally = `${right}/${total} right${wrong.length ? `; wrong:\n  ${wrong.join('\n  ')}` : ''}`;
      if (process.env['TAALCUT_FIXTURE_TALLY']) console.warn(`scene-text fixtures: ${tally}`);
      expect(lost, tally).toEqual([]);
      expect(right / total, tally).toBeGreaterThanOrEqual(0.95);
    },
  );
});
