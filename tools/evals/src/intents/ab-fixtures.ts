// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Synthetic arms for the LRN1-CTX intent A/B, labelled by construction, so the harness runs end to end before
 * real Analyst runs exist (tools/evals SPEC: real labels and ratings are a human input). Two reels:
 * - `four-slot`: the casting fixture's template (`syntheticCastingTemplate`), whose intents name what each shot
 *   is of; the without-context arm says only what one frame alone shows. The casting A/B reads this one.
 * - `talking-tips`: a talking-to-camera list reel with on-screen text and speech; the without-context arm's
 *   breakdown kept a disputed cut the other dropped, so one of its slots pairs with nothing.
 * Every number made from these is synthetic and never a gate result.
 */
import { join } from 'node:path';
import { FrameRate, newId, RationalTime, templateSchema, type Template } from '@taalcut/core';
import { CASTING_FIXTURE_SLOTS, syntheticCastingTemplate } from '../casting/fixtures';
import { fixtureTemplate } from '../casting/template';
import { writeJson } from '../files';
import type { Arm } from './ab-arms';

/** What an Analyst that sees one frame alone writes for the casting fixture's four slots. */
const FRAME_ONLY = [
  'a static wide shot of a room',
  'a wide shot, the camera moves',
  'a handheld close up',
  'a static close up of a colour',
];

/** The casting fixture's slots (the same lengths, motion and energy) with the frame-only intents. */
function fourSlotFrameOnly(): Template {
  return fixtureTemplate(
    CASTING_FIXTURE_SLOTS.map((slot, index) => ({ ...slot, intent: FRAME_ONLY[index] ?? slot.intent })),
  );
}

const ms = (value: number) => RationalTime.of(value, FrameRate.of(1000));
const at = (frames: number) => RationalTime.of(frames, FrameRate.of(30));

/** The talking-tips reel: three slots, a title over the first and a numbered tip over each of the others. */
function talkingTips(cuts: readonly number[], intents: readonly string[]): Template {
  const bounds = [0, ...cuts, 90];
  const base = fixtureTemplate(
    bounds.slice(0, -1).map((start, index) => ({
      frames: (bounds[index + 1] ?? start + 1) - start,
      intent: intents[index] ?? 'talking to camera',
      motion: 'static',
      energy: 0.5,
    })),
  );
  const line = (text: string, start: number, end: number, y: number) => ({
    id: newId<'TextOverlay'>(),
    text,
    role: 'title' as const,
    start: at(start),
    duration: at(end - start),
    slotId: null,
    box: { x: 0.1, y, width: 0.8, height: 0.08 },
    appearance: { size: 0.05, align: 'center' as const, case: 'mixed' as const, background: 'box' as const },
    styleKey: 'title',
    reveal: 'pop' as const,
    language: 'en',
    confidence: 0.9,
  });
  return templateSchema.parse({
    ...base,
    text: [
      line('3 mistakes beginners make', 0, 30, 0.1),
      line('1. wrong shoes', 30, 60, 0.8),
      line('2. no warm-up', 60, 90, 0.8),
    ],
    audio: {
      kind: 'voice',
      loudnessLufs: -16,
      sound: null,
      speech: {
        language: 'en',
        coverage: 0.9,
        segments: [
          { start: ms(0), duration: ms(1000), text: 'three mistakes every beginner makes' },
          { start: ms(1000), duration: ms(1000), text: 'first, buying the wrong shoes' },
          { start: ms(2000), duration: ms(1000), text: 'second, skipping the warm-up' },
        ],
      },
      waveform: null,
    },
  });
}

export type FixtureReel = 'four-slot' | 'talking-tips';

/** The two arms, by reel: what `abFixtures` writes. */
export function syntheticArms(): Record<Arm, Record<FixtureReel, Template>> {
  return {
    with: {
      'four-slot': syntheticCastingTemplate(),
      'talking-tips': talkingTips(
        [30, 60],
        [
          'talking to camera, mid shot, the hook that names the three mistakes',
          'talking to camera, mid shot, first tip: holding up a running shoe',
          'talking to camera, mid shot, second tip: a quick stretch',
        ],
      ),
    },
    without: {
      'four-slot': fourSlotFrameOnly(),
      // The without-context run kept a disputed cut at 45 the other run dropped: its slot 45–60 pairs with nothing.
      'talking-tips': talkingTips(
        [30, 45, 60],
        [
          'a person talking in a room',
          'a person talking in a room',
          'a person holding something',
          'a person standing',
        ],
      ),
    },
  };
}

/** Writes `<outDir>/with/<reel>.json` and `<outDir>/without/<reel>.json`. */
export function abFixtures(outDir: string): Record<Arm, string> {
  const arms = syntheticArms();
  const dirs = { with: join(outDir, 'with'), without: join(outDir, 'without') };
  for (const arm of ['with', 'without'] as const)
    for (const [reel, template] of Object.entries(arms[arm]))
      writeJson(join(dirs[arm], `${reel}.json`), template);
  return dirs;
}
