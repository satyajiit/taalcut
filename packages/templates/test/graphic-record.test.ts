// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ on FIX-SIGN: the text stage's record of a reading is a fact of its brief. What the fused evidence settled
 * (composited, or the scene's, or what its tie-break answered) the model can't overturn; unsure text is the model's to
 * decide; and the record's strongest signals are the prompt's evidence and a footage brief's reason. Made-up reels.
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, textOverlaySchema, type TextOverlay } from '@taalcut/core';
import {
  composeBriefs,
  graphicFacts,
  graphicQuestion,
  textRecord,
  type GraphicAnswer,
  type GraphicReel,
} from '../src/breakdown/graphic-brief';
import type { DraftTextRegion } from '../src/breakdown/text-judge';

const RATE = FrameRate.of(30);
const at = (frame: number) => RationalTime.of(frame, RATE);

function overlay(id: string, text: string, maybeScene: boolean): TextOverlay {
  return textOverlaySchema.parse({
    id,
    text,
    role: 'caption',
    start: at(10),
    duration: at(50),
    slotId: null,
    box: { x: 0.3, y: 0.4, width: 0.3, height: 0.04 },
    appearance: { size: 0.03, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'caption',
    reveal: 'none',
    language: 'en',
    confidence: 0.9,
    ...(maybeScene ? { doubts: [{ reason: 'textMaybeScene', confidence: 0.5 }] } : {}),
  });
}

function region(overlayId: string, over: Partial<DraftTextRegion>): DraftTextRegion {
  return {
    overlayId,
    text: 'WORDS',
    box: { x: 0.3, y: 0.4, width: 0.3, height: 0.04 },
    start: 10,
    end: 60,
    kind: 'composited',
    score: -4,
    sceneProbability: 0.02,
    signals: { fixedOnPicture: -4, rendered: -0.6, short: 0.1 },
    lean: null,
    site: 0,
    ...over,
  };
}

const answer = (over: Partial<GraphicAnswer> = {}): GraphicAnswer => ({
  graphic: true,
  reason: null,
  kind: 'title',
  what: 'a title',
  role: 'hook',
  answers: null,
  platform: 'neutral',
  look: 'white bold words',
  shadow: false,
  avatar: false,
  ...over,
});

const ADDED = '01JDSG1REC0RD0000000000001';
const UNSURE = '01JDSG1REC0RD0000000000002';
const regions = [
  region(ADDED, {}),
  region(UNSURE, {
    kind: 'unsure',
    score: 0.4,
    sceneProbability: 0.6,
    signals: { withShot: 1.2, tilt: 0.9, rendered: -0.4 },
  }),
];
const text = [overlay(ADDED, 'BIG NEWS', false), overlay(UNSURE, 'OPEN 24 HOURS', true)];
const reel: GraphicReel = {
  rate: RATE,
  canvas: { width: 1080, height: 1920 },
  text,
  beats: [],
  cuts: [],
  speech: [],
  textRegions: regions,
};
const inputs = (answers: (GraphicAnswer | null)[]) =>
  text.map((item, index) => ({ overlay: item, facts: graphicFacts(reel, item), answer: answers[index]! }));

describe('FIX-SIGN records in the graphic briefs', () => {
  it('reads a record as words: the verdict, its scene probability and the strongest signals first', () => {
    const record = textRecord(regions, UNSURE)!;
    expect(record.kind).toBe('unsure');
    expect(record.signals).toEqual([
      'it lives exactly as long as its shot, as scene text often does',
      'it is tilted or in perspective, as a sign on a surface is',
      'its contrast is a rendered graphic’s',
    ]);
    expect(record.words).toMatch(/^unsure \(scene probability 0\.6\): it lives exactly/);
    expect(textRecord(regions, 'missing')).toBeNull();
    // Weights under 0.3 aren't evidence worth saying.
    expect(textRecord(regions, ADDED)!.signals).not.toContain('it flickers on briefly');
  });

  it('gives the record to the model as measured evidence', () => {
    const question = graphicQuestion(
      text.map((item) => ({ overlay: item, facts: graphicFacts(reel, item) })),
      0,
    );
    expect(question).toContain(
      'Measured evidence: added in editing (scene probability 0.02): it stays put while the picture moves behind it',
    );
    expect(question).not.toContain('came and went with its shot');
  });

  it('keeps composited text a graphic whatever the model says; unsure text is the model’s to decide', () => {
    const [added, unsure] = composeBriefs(
      inputs([answer({ graphic: false, reason: 'A sign.' }), answer({ graphic: true, kind: 'title' })]),
    );
    expect(added).toMatchObject({ graphic: true, reason: null, kind: 'title', source: 'model' });
    expect(unsure).toMatchObject({ graphic: true, kind: 'title' });
    const [, footage] = composeBriefs(
      inputs([answer(), answer({ graphic: false, reason: 'A shop sign on the wall.' })]),
    );
    expect(footage).toMatchObject({ graphic: false, reason: 'A shop sign on the wall.' });
  });

  it('with no answer, unsure text is footage for the record’s own reasons', () => {
    const [added, unsure] = composeBriefs(inputs([null, null]));
    expect(added!.graphic).toBe(true);
    expect(unsure).toMatchObject({
      graphic: false,
      reason:
        'Taalcut wasn’t sure it was added in editing: it lives exactly as long as its shot, as scene text often ' +
        'does; it is tilted or in perspective, as a sign on a surface is; its contrast is a rendered graphic’s.',
      source: 'facts',
    });
  });

  it('the tie-break’s answer settles unsure text', () => {
    const asked: GraphicReel = {
      ...reel,
      textRegions: [regions[0]!, { ...regions[1]!, asked: 'composited' }],
    };
    const [, unsure] = composeBriefs(
      text.map((item) => ({
        overlay: item,
        facts: graphicFacts(asked, item),
        answer: answer({ graphic: false }),
      })),
    );
    expect(unsure!.graphic).toBe(true);
  });

  it('a composited verdict on the look alone (a sign board on a still camera) is the model’s to check', () => {
    const board: GraphicReel = {
      ...reel,
      textRegions: [
        region(ADDED, {
          score: -2.1,
          sceneProbability: 0.11,
          signals: { shape: -2.5, rendered: -0.2, withShot: 0.6 },
        }),
        regions[1]!,
      ],
    };
    const record = textRecord(board.textRegions, ADDED)!;
    expect(record.lookAlone).toBe(true);
    expect(textRecord(regions, ADDED)!.lookAlone).toBe(false);
    const briefsOf = (said: GraphicAnswer | null) =>
      composeBriefs(
        text.map((item) => ({
          overlay: item,
          facts: graphicFacts(board, item),
          answer: item.id === ADDED ? said : null,
        })),
      )[0]!;
    expect(briefsOf(answer({ graphic: false, reason: 'The shop’s own sign.' }))).toMatchObject({
      graphic: false,
      reason: 'The shop’s own sign.',
    });
    expect(briefsOf(null).graphic).toBe(true);
    expect(
      graphicQuestion(
        text.map((item) => ({ overlay: item, facts: graphicFacts(board, item) })),
        0,
      ),
    ).toContain(
      'Measured evidence: unsure: it sits on an even fill bounded on every side, as a graphic’s box does, and a sign board too; it lives exactly as long as its shot, as scene text often does.',
    );
  });
});
