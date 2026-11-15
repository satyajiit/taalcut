// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LYR1: a sequence's place read again. The pages are made up: one word at a time at the frame's middle, some of
 * them unreadable over a busy picture, with the scene's print beside and behind them.
 */
import { describe, expect, it } from 'vitest';
import { FrameRates, newId, ok, RationalTime, type TextOverlay } from '@taalcut/core';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import type { OcrLine, OcrRegionPage } from '../src/breakdown/ports';
import type { StepContext } from '../src/breakdown/steps';
import { sequenceRuleFor } from '../src/breakdown/text-sequence';
import { UNREAD_TEXT, zoneFrames, zonePieces, type ZoneOptions } from '../src/breakdown/text-zone';
import { refinePlace, wordOn, zonePlace } from '../src/breakdown/text-zone-place';
import { rereadSequences } from '../src/breakdown/text-zone-read';
import { sequenceRun, settleCase } from '../src/breakdown/text-zone-run';

const rate = FrameRates.fps30;
const rule = sequenceRuleFor(BREAKDOWN_CONFIG.textScene.sequence, rate);
const CUTS = [47, 84, 152, 161];
const options: ZoneOptions = {
  cuts: CUTS,
  minConfidence: 0.5,
  sizeRatio: 1.6,
  changeRatio: 2.5,
  tinyFrames: rule.gapFrames,
};

/** A word centred on the frame's middle, as wide as it is long. */
const wordBox = (text: string) => {
  const width = 0.045 * text.length;
  return { x: 0.5 - width / 2, y: 0.475, width, height: 0.044 };
};
const line = (text: string, box = wordBox(text), confidence = 1): OcrLine => ({
  text,
  confidence,
  box,
  language: 'en',
});
/** The scene's print: a line that runs to the cut-out's left side, one on another line, one far smaller. */
const PRINT: OcrLine[] = [
  line('ure Time: 1650', { x: 0.25, y: 0.47, width: 0.2, height: 0.04 }),
  line('Boarding Zone', { x: 0.38, y: 0.42, width: 0.2, height: 0.04 }),
  line('/ 3', { x: 0.47, y: 0.49, width: 0.03, height: 0.012 }),
];

/** What shows when: each word's frames, whether an engine can read it there, and the print behind it. */
interface Shown {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Frames it can be read on; all of them when absent. */
  readonly readable?: readonly [number, number];
  readonly as?: (frame: number) => string;
}
const LYRIC: Shown[] = [
  { text: 'I hope', start: 10, end: 44, as: (frame) => (frame % 3 === 0 ? 'Thope' : 'I hope') },
  { text: 'You', start: 44, end: 52, as: (frame) => (frame < 47 ? 'You' : 'ou') },
  { text: 'Leave', start: 52, end: 70, as: (frame) => (frame % 4 === 0 ? 'leave' : 'Leave') },
  { text: 'And', start: 70, end: 81, readable: [0, 0] },
  { text: "Don't", start: 81, end: 98, readable: [84, 98] },
  { text: 'Come', start: 98, end: 110 },
  { text: 'Back', start: 110, end: 127 },
  { text: 'Cause', start: 127, end: 141 },
  { text: "I'm", start: 141, end: 153, readable: [152, 153] },
];
/** The picture changes this much where a word is replaced or a shot starts, and this little otherwise. */
const SWAP = 0.12;
const STILL = 0.006;

/** A reading of `word` as `text`: a scrap of it has the box of what was read, lower letters only. */
function read(text: string, word: string): OcrLine {
  if (text.length >= word.length) return line(text);
  const box = wordBox(text);
  return line(text, { ...box, y: box.y + box.height * 0.35, height: box.height * 0.65 });
}

function pageAt(frame: number, shown: readonly Shown[], extra: readonly OcrLine[] = []): OcrRegionPage {
  const word = shown.find((item) => frame >= item.start && frame < item.end);
  const readable =
    word && (!word.readable || (frame >= word.readable[0] && frame < word.readable[1])) ? word : undefined;
  const changes = shown.some((item) => item.start === frame || item.end === frame) || CUTS.includes(frame);
  const print = frame >= 47 && frame < 84 ? PRINT : [];
  return {
    frame,
    change: changes ? SWAP : STILL,
    lines: [
      ...print,
      ...extra,
      ...(readable ? [read(readable.as?.(frame) ?? readable.text, readable.text)] : []),
    ],
  };
}
const pagesOf = (from: number, to: number, shown: readonly Shown[] = LYRIC) =>
  Array.from({ length: to - from }, (_, at) => pageAt(from + at, shown));
/** The place read at two enlargements, as the config asks: each frame votes twice. */
const framesOf = (from: number, to: number, shown: readonly Shown[] = LYRIC) =>
  zoneFrames([pagesOf(from, to, shown), pagesOf(from, to, shown)]);

/** The place the first pass's chain gives: Don't, Come, Back, Cause. */
const place = zonePlace(['Dont', 'Come', 'Back', 'Cause'].map((text) => wordBox(text)));
const said = (pieces: readonly { text: string | null; start: number; end: number }[]) =>
  pieces.map((piece) => `${piece.text ?? '?'} ${piece.start}-${piece.end}`);

describe('zonePlace and wordOn', () => {
  it('reads round the words and tests a line by its line, size, anchor and the cut-out’s sides', () => {
    expect(place.watch.x).toBeCloseTo(0.3875);
    expect(place.region.x).toBeLessThan(place.watch.x);
    expect(place.region.y).toBeCloseTo(0.431);
    const test = { minConfidence: 0.5, sizeRatio: 1.6 };
    expect(wordOn([...PRINT, line('You')], place, test)?.text).toBe('You');
    expect(wordOn(PRINT, place, test)).toBeNull();
    // On the words' line and in their size, but set away from where they are: the scene's.
    expect(
      wordOn([line('Immigration', { x: 0.27, y: 0.475, width: 0.2, height: 0.044 })], place, test),
    ).toBeNull();
    expect(wordOn([line('You', wordBox('You'), 0.3)], place, test)).toBeNull();
  });

  it('keeps only the anchors the read words share', () => {
    const open = zonePlace([wordBox('Come'), wordBox('Back')]);
    expect(open.anchors.map((anchor) => anchor.side)).toEqual(['centre', 'left', 'right']);
    const refined = refinePlace(open, [wordBox('I hope'), wordBox('You'), wordBox('Cause')]);
    expect(refined.anchors.map((anchor) => anchor.side)).toEqual(['centre']);
  });
});

describe('zonePieces', () => {
  const pieces = zonePieces(framesOf(0, 200), place, options);

  it('tiles the time by the picture’s jumps and names each stretch by what most frames read', () => {
    expect(said(pieces).slice(0, 10)).toEqual([
      '? 0-10',
      'I hope 10-44',
      'You 44-52',
      'Leave 52-70',
      '? 70-81',
      "Don't 81-98",
      'Come 98-110',
      'Back 110-127',
      'Cause 127-141',
      "I'm 141-153",
    ]);
  });

  it('keeps a word across a cut as one piece when its readings either side are alike', () => {
    // "You" is read whole before the cut at 47 and as "ou" over the busy shot after it.
    expect(pieces[2]).toMatchObject({ text: 'You', start: 44, end: 52 });
  });

  it('joins a few unread frames to the word after them, and lets a moment’s reading name an unread stretch', () => {
    // "Don't" could not be read for its first three frames; "I'm" only on its last, after the cut.
    expect(pieces[5]).toMatchObject({ text: "Don't", start: 81, end: 98 });
    expect(pieces[9]).toMatchObject({ text: "I'm", start: 141, end: 153 });
  });

  it('leaves a stretch no frame read without words, in the words’ place', () => {
    expect(pieces[4]).toMatchObject({ text: null, start: 70, end: 81, samples: 0, confidence: 0 });
    expect(pieces[4]!.box.x).toBeCloseTo(place.left);
  });

  it('splits a stretch by its readings when the picture’s jump is missed', () => {
    const quiet = pagesOf(90, 135).map((page) =>
      page.frame === 110 ? { ...page, change: STILL * 1.5 } : page,
    );
    const found = zonePieces(zoneFrames([quiet, quiet]), place, options);
    expect(said(found)).toContain('Come 98-110');
    expect(said(found)).toContain('Back 110-127');
  });

  it('needs two readings for a word: one frame at one enlargement is not enough', () => {
    const once = zonePieces(zoneFrames([pagesOf(120, 200)]), place, options);
    expect(said(once)).toContain('Cause 127-141');
    expect(once.find((piece) => piece.text === 'Cause')!.samples).toBe(14);
    // "I'm" was read on one frame only: at one enlargement that is one reading, and it stays unread.
    expect(once.some((piece) => piece.text === "I'm")).toBe(false);
  });
});

describe('sequenceRun and settleCase', () => {
  const pieces = zonePieces(framesOf(0, 200), place, options);

  it('takes the words round the chain, an unread piece between them, and not the picture before or after', () => {
    const run = sequenceRun(pieces, { start: 84, end: 141 }, rule);
    expect(said(run)).toEqual([
      'I hope 10-44',
      'You 44-52',
      'Leave 52-70',
      '? 70-81',
      "Don't 81-98",
      'Come 98-110',
      'Back 110-127',
      'Cause 127-141',
      "I'm 141-153",
    ]);
  });

  it('stops at a pause: one sign read where the words were, shots later, is not the sequence’s', () => {
    const sign: Shown = { text: 'Arrivals', start: 170, end: 177 };
    const found = zonePieces(framesOf(0, 200, [...LYRIC, sign]), place, options);
    expect(said(found)).toContain('Arrivals 170-177');
    const run = sequenceRun(found, { start: 84, end: 141 }, rule);
    expect(run[run.length - 1]).toMatchObject({ text: "I'm", end: 153 });
  });

  it('gives a piece the lettering most pieces have, when a frame read it so', () => {
    const run = settleCase(sequenceRun(pieces, { start: 84, end: 141 }, rule));
    expect(run.find((piece) => piece.start === 52)!.text).toBe('Leave');
    const lower = { ...run[2]!, text: 'leave', spellings: ['leave'] };
    expect(settleCase([...run.slice(0, 2), lower, ...run.slice(3)])[2]!.text).toBe('leave');
  });
});

describe('rereadSequences', () => {
  function overlay(text: string, start: number, end: number): TextOverlay {
    const box = wordBox(text);
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
      confidence: 1,
    };
  }
  /** What the whole-frame pass kept of the lyric: a scrap of the first word and the four words it chained. */
  const firstPass = () => [
    overlay('hope', 15, 41),
    overlay("Don't", 84, 98),
    overlay('Come', 98, 110),
    overlay('Back', 110, 127),
    overlay('Cause', 127, 141),
  ];
  const asked: number[][] = [];
  const context = (ocrRegion?: NonNullable<StepContext['analysers']['vision']['ocrRegion']>): StepContext =>
    ({
      path: '/reel.mp4',
      dir: '/experiment',
      rate,
      total: 440,
      analysers: { vision: ocrRegion ? { ocrRegion } : {}, media: {}, audio: {} },
      config: BREAKDOWN_CONFIG,
      signal: new AbortController().signal,
    }) as unknown as StepContext;
  /** The port: a page's change is from the frame asked before it, so the first of a call has none. */
  const port: NonNullable<StepContext['analysers']['vision']['ocrRegion']> = async (_path, request) => {
    asked.push([...request.frames]);
    return ok(
      request.frames.map((frame, at) => {
        const page = pageAt(frame, LYRIC);
        const before = request.frames[at - 1];
        return { ...page, change: before === undefined ? 0 : before === frame - 1 ? page.change : 0.9 };
      }),
    );
  };

  it('swaps the chain’s readings for the pieces its place gives, reading further out while the words go on', async () => {
    asked.length = 0;
    const first = firstPass();
    const read = { overlays: first, evidence: first.map(() => ({ samples: 3, drift: 0 })) };
    const again = await rereadSequences(context(port), read, {
      cuts: CUTS,
      newId: () => newId<'TextOverlay'>(),
    });
    expect(
      again.overlays.map(
        (item) => `${item.text} ${item.start.value}-${item.start.value + item.duration.value}`,
      ),
    ).toEqual([
      'I hope 10-44',
      'hope 15-41',
      'You 44-52',
      'Leave 52-70',
      `${UNREAD_TEXT} 70-81`,
      "Don't 81-98",
      'Come 98-110',
      'Back 110-127',
      'Cause 127-141',
      "I'm 141-153",
    ]);
    expect(again.unread).toEqual([again.overlays[4]!.id]);
    expect(again.evidence).toHaveLength(again.overlays.length);
    // The chain's own readings are gone; the scrap of the first word stays for the judge to drop.
    expect(
      again.overlays.filter((item) => first.some((old) => old.id === item.id)).map((item) => item.text),
    ).toEqual(['hope']);
    // Read first round the chain (84 to 141 and a margin), then further back: "I hope" still showed at the edge.
    expect(asked[0]![0]).toBe(39);
    expect(Math.min(...asked.flat())).toBe(0);
    expect(BREAKDOWN_CONFIG.textScene.sequence.zone.scales.length).toBeGreaterThan(0);
  });

  it('keeps the first pass as it was without the port, and when the place gives no sequence', async () => {
    const first = firstPass();
    const read = { overlays: first, evidence: first.map(() => ({ samples: 3, drift: 0 })) };
    const ids = () => newId<'TextOverlay'>();
    const without = await rereadSequences(context(), read, { cuts: CUTS, newId: ids });
    expect(without.overlays).toEqual(first);
    // The place shows one sign the whole time: a chain of two alike readings is not worth the read, and a chain the
    // place reads as one piece keeps its readings.
    const sign: Shown[] = [{ text: 'Gate 12', start: 0, end: 440 }];
    const still: typeof port = async (_path, request) =>
      ok(request.frames.map((frame) => ({ ...pageAt(frame, sign), change: STILL })));
    const two = [overlay('Gate 12', 90, 110), overlay('Cafe', 110, 130)];
    const kept = await rereadSequences(
      context(still),
      { overlays: two, evidence: two.map(() => ({ samples: 3, drift: 0 })) },
      { cuts: [], newId: ids },
    );
    expect(kept.overlays).toEqual(two);
    expect(kept.unread).toEqual([]);
  });
});
