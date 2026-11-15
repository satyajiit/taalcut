// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LYR1: text that replaces itself in place (a lyric a word at a time, captions line after line) is one sequence
 * across its shots. Its pieces are kept, each with its own time; scenery beside it, a sign misread three ways and a
 * scrap read in its place are not. Made-up text, boxes and cuts.
 */
import { describe, expect, it } from 'vitest';
import { FrameRates, newId, RationalTime, type Template, type TextOverlay } from '@taalcut/core';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import type { PixelEvidence } from '../src/breakdown/text-motion';
import { verdictOf, weighText, type TextEvidence } from '../src/breakdown/text-scene';
import {
  isReplacing,
  replacingTexts,
  sequenceRuleFor,
  sequenceWords,
  templateTextSequences,
  textChains,
  textSequences,
  type PlacedText,
} from '../src/breakdown/text-sequence';

const rate = FrameRates.fps30;
const config = BREAKDOWN_CONFIG.textScene;
const rule = sequenceRuleFor(config.sequence, rate);
const TOTAL = 440;
/** The shots the words run over. */
const CUTS = [47, 84, 152, 161];

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

/** A word centred on the frame's middle, as wide as it is long. */
const word = (text: string, start: number, end: number) => {
  const width = 0.05 * text.length;
  return overlay(text, start, end, { x: 0.5 - width / 2, y: 0.47, width, height: 0.045 });
};
const placed = (overlays: readonly TextOverlay[]): PlacedText[] =>
  overlays.map((item) => ({
    text: item.text,
    box: item.box,
    start: item.start.value,
    end: item.start.value + item.duration.value,
  }));
const weigh = (overlays: TextOverlay[], evidence: (TextEvidence | undefined)[] = []) =>
  weighText(overlays, evidence, { cuts: CUTS, total: TOTAL, rate, config });

/** Nine words, one at a time, with no pause between them, over three shots. */
const lyric = () => [
  word('I hope', 10, 44),
  word('You', 44, 52),
  word('Leave', 52, 70),
  word('And', 70, 81),
  word("Don't", 81, 98),
  word('Come', 98, 110),
  word('Back', 110, 127),
  word('Cause', 127, 141),
  word("I'm", 141, 153),
];

describe('textChains and isReplacing', () => {
  it('chains words that take each other’s place across cuts, and calls them text replacing itself', () => {
    const pieces = placed(lyric());
    const chains = textChains(pieces, rule);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.members).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(chains[0]).toMatchObject({ start: 10, end: 153 });
    expect(isReplacing(chains[0]!, pieces, { cuts: CUTS, near: 2, rule })).toBe(true);
  });

  it('does not chain words that are apart in time, in place or in size', () => {
    const base = word('Come', 98, 110);
    const later = word('Back', 130, 150);
    const lower = overlay('Back', 110, 127, { ...base.box, y: 0.7 });
    const bigger = overlay('Back', 110, 127, { ...base.box, y: 0.44, height: 0.1 });
    for (const other of [later, lower, bigger]) expect(textChains(placed([base, other]), rule)).toEqual([]);
  });

  it('never lets a reading follow itself: one word read twice is not two pieces', () => {
    expect(textChains(placed([word('Back', 100, 110), word('Back', 110, 127)]), rule)).toEqual([]);
  });

  it('is not sure of two pieces, of a sign read three ways, or of signs that change only with the shots', () => {
    const two = placed([word('Come', 98, 110), word('Back', 110, 127)]);
    expect(textChains(two, rule)).toHaveLength(1);
    expect(replacingTexts(two, { cuts: CUTS, near: 2, rule })).toEqual([]);
    const box = { x: 0.85, y: 0.46, width: 0.1, height: 0.05 };
    const misread = placed([
      overlay('TR Line', 100, 112, box),
      overlay('19 Line', 112, 126, box),
      overlay('VR Line', 126, 140, box),
    ]);
    expect(replacingTexts(misread, { cuts: CUTS, near: 2, rule })).toEqual([]);
    const shots = placed([
      overlay('Departures', 30, 47, box),
      overlay('Gate 12', 47, 84, box),
      overlay('Baggage', 84, 152, box),
    ]);
    expect(replacingTexts(shots, { cuts: CUTS, near: 2, rule })).toEqual([]);
  });

  it('names what was read inside a sequence’s place while it showed, and nothing beside it', () => {
    const words = lyric();
    const scrap = overlay('/ 3', 54, 58, { x: 0.47, y: 0.455, width: 0.04, height: 0.012 });
    const beside = overlay('Boarding Time', 48, 78, { x: 0.1, y: 0.42, width: 0.2, height: 0.04 });
    const after = overlay('Immigration', 161, 170, { x: 0.4, y: 0.47, width: 0.2, height: 0.04 });
    const found = replacingTexts(placed([...words, scrap, beside, after]), { cuts: CUTS, near: 2, rule });
    expect(found).toHaveLength(1);
    expect(found[0]!.noise).toEqual([9]);
  });
});

describe('weighText on a sequence', () => {
  it('keeps every word of a sequence that runs across cuts, and says why', () => {
    const judged = weigh(lyric());
    expect(judged.map(verdictOf)).toEqual(new Array(9).fill('overlay'));
    for (const judgement of judged) {
      expect(judgement.sequence).toBe(0);
      expect(judgement.signals.sequence).toBe(config.weights.sequence);
      // Brief by design, alike to its neighbours by chance, and replaced by design: none of it counts against it.
      expect(judgement.signals).not.toHaveProperty('short');
      expect(judgement.signals).not.toHaveProperty('misread');
      expect(judgement.signals).not.toHaveProperty('replaced');
      expect(judgement.signals).not.toHaveProperty('interrupted');
    }
    expect(new Set(judged.map((judgement) => judgement.site)).size).toBe(1);
  });

  it('keeps two alike words in a sequence apart: neither is the other misread', () => {
    const words = [
      word('Come', 98, 110),
      word('Cone', 110, 122),
      word('Back', 122, 136),
      word('Home', 136, 150),
    ];
    const judged = weigh(words);
    expect(judged.map(verdictOf)).toEqual(['overlay', 'overlay', 'overlay', 'overlay']);
    expect(judged.every((judgement) => judgement.signals.misread === undefined)).toBe(true);
  });

  it('drops the scenery beside a sequence, and does not let it weigh on the words', () => {
    const words = lyric();
    const signs = ['Boarding Time', 'Gate 02', 'Seat 23A', 'Flight QP1563'].map((text, at) =>
      overlay(text, 47, 84, { x: 0.02, y: 0.3 + at * 0.06, width: 0.2, height: 0.03 }),
    );
    const evidence = [
      ...words.map(() => ({ samples: 6, drift: 0.1, block: 2 })),
      ...signs.map(() => undefined),
    ];
    const judged = weigh([...words, ...signs], evidence);
    expect(judged.slice(0, 9).map(verdictOf)).toEqual(new Array(9).fill('overlay'));
    expect(judged.slice(9).map(verdictOf)).toEqual(['scene', 'scene', 'scene', 'scene']);
    // Signage beside a word is the picture it was laid over, and a busy shot's cut is not the words'.
    for (const judgement of judged.slice(0, 9)) {
      expect(judgement.signals).not.toHaveProperty('block');
      expect(judgement.signals).not.toHaveProperty('crowd');
    }
  });

  it('drops a scrap read in the sequence’s place, whatever it weighed', () => {
    const scrap = overlay('/ 3', 54, 58, { x: 0.47, y: 0.455, width: 0.04, height: 0.012 });
    const judged = weigh([...lyric(), scrap]);
    expect(judged[9]!.within).toBe(0);
    expect(verdictOf(judged[9]!)).toBe('scene');
    expect(judged.slice(0, 9).every((judgement) => judgement.within === null)).toBe(true);
  });

  it('still drops a sign misread three ways at one place', () => {
    const box = { x: 0.85, y: 0.46, width: 0.04, height: 0.05 };
    const signs = [
      overlay('TR Line', 100, 112, box),
      overlay('19 Line', 112, 126, box),
      overlay('VR Line', 126, 140, box),
    ];
    const judged = weigh(signs, [
      { samples: 4, drift: 0.9 },
      { samples: 4, drift: 0.9 },
      { samples: 4, drift: 0.9 },
    ]);
    expect(judged.map((judgement) => judgement.sequence)).toEqual([null, null, null]);
    expect(judged.map(verdictOf)).toEqual(['scene', 'scene', 'scene']);
  });

  it('keeps captions that follow each other line after line as one sequence', () => {
    const line = (text: string, start: number, end: number) =>
      overlay(text, start, end, { x: 0.2, y: 0.8, width: 0.6, height: 0.04 });
    const captions = [
      line('so I packed the night before', 170, 215),
      line('and of course I forgot the charger', 215, 262),
      line('which is why this looks like that', 262, 300),
    ];
    const judged = weighText(captions, [], { cuts: [150, 240, 280], total: TOTAL, rate, config });
    expect(judged.map(verdictOf)).toEqual(['overlay', 'overlay', 'overlay']);
    expect(judged.map((judgement) => judgement.sequence)).toEqual([0, 0, 0]);
  });

  it('lets a sequence that is the scene’s after all go, and what was read in its place keeps its own verdict', () => {
    // A board whose words change in turn, cut off by the frame's edge and moving with the picture round it.
    const box = { x: 0.9, y: 0.3, width: 0.1, height: 0.05 };
    const board = [
      overlay('Exit', 100, 112, box),
      overlay('Tickets', 112, 126, box),
      overlay('Platform', 126, 140, box),
    ];
    const scrap = overlay('7', 114, 120, { x: 0.93, y: 0.31, width: 0.02, height: 0.03 });
    const moving: PixelEvidence = {
      pairs: 4,
      withPicture: 1,
      fixedOnPicture: 0,
      ownMove: 0,
      covered: 0,
      fill: 0.1,
      bounded: false,
      contrast: 90,
    };
    const judged = weighText([...board, scrap], [], {
      cuts: CUTS,
      total: TOTAL,
      rate,
      config,
      pixels: [moving, moving, moving, null],
    });
    expect(judged.slice(0, 3).map((judgement) => judgement.sequence)).toEqual([0, 0, 0]);
    expect(judged.slice(0, 3).map(verdictOf)).toEqual(['scene', 'scene', 'scene']);
    expect(judged[3]!.within).toBeNull();
  });
});

describe('a template’s sequences', () => {
  const template = (text: TextOverlay[]): Pick<Template, 'text' | 'canvas'> => ({
    text,
    canvas: { width: 1080, height: 1920, rate },
  });

  it('finds the sequence among stored overlays, in order, with each one’s frames', () => {
    const title = overlay('Pune to Kolkata', 200, 290, { x: 0.2, y: 0.1, width: 0.6, height: 0.06 });
    const words = lyric();
    const found = templateTextSequences(template([title, ...words]));
    expect(found).toHaveLength(1);
    expect(found[0]!.ids).toEqual(words.map((item) => item.id));
    expect(found[0]).toMatchObject({ start: 10, end: 153 });
    expect(found[0]!.frames).toEqual([34, 8, 18, 11, 17, 12, 17, 14, 12]);
    expect(sequenceWords(found[0]!, rate)).toBe(
      'a 9-text sequence, one at a time, 0.33–5.10 s (about 0.5 s each)',
    );
  });

  it('counts two stored texts in turn as a sequence, and texts apart as none', () => {
    const two = [word('Come', 98, 110), word('Back', 110, 127)];
    expect(textSequences(two, rate, rule).map((sequence) => sequence.ids.length)).toEqual([2]);
    const apart = [word('Come', 98, 110), word('Back', 160, 180)];
    expect(textSequences(apart, rate, rule)).toEqual([]);
  });
});
