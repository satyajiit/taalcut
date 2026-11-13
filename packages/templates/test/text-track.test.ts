// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Text de-duplication and edge refinement; interface chrome dropped from screen recordings. */
import { describe, expect, it } from 'vitest';
import { FrameRates, newId } from '@taalcut/core';
import {
  boxIou,
  BREAKDOWN_CONFIG,
  dropChrome,
  matchesTrack,
  normaliseText,
  overlayFromTrack,
  refineEdge,
  textSimilarity,
  trackText,
  type OcrLine,
  type OcrPage,
} from '../src/index';

const config = BREAKDOWN_CONFIG.text;
const title = { x: 0.1, y: 0.2, width: 0.8, height: 0.08 };
const line = (text: string, box = title, confidence = 0.9): OcrLine => ({
  text,
  box,
  confidence,
  language: 'en',
});
/** Samples every 7.5 frames at 30 fps (4 fps), frames rounded like the scan. */
const pages = (lines: (OcrLine[] | null)[]): OcrPage[] =>
  lines.map((items, index) => ({ frame: Math.round(index * 7.5), lines: items ?? [] }));

describe('text similarity and boxes', () => {
  it('normalises case, punctuation and Unicode forms, Devanagari included', () => {
    expect(normaliseText('  DAY 1 — in Goa!! ')).toBe('day 1 in goa');
    expect(textSimilarity('Day 1 in Goa', 'day 1 in goa.')).toBe(1);
    expect(textSimilarity('गोवा में पहला दिन', 'गोवा में पहला दिन')).toBe(1);
    expect(textSimilarity('Day 1 in Goa', 'Day 7 in Goa')).toBeGreaterThan(0.85);
    expect(textSimilarity('Goa', 'Paris')).toBeLessThan(0.5);
    expect(boxIou(title, title)).toBeCloseTo(1);
    expect(boxIou(title, { x: 0, y: 0.9, width: 0.1, height: 0.1 })).toBe(0);
  });
});

describe('trackText', () => {
  it('merges a line across samples despite OCR noise and keeps a different line apart', () => {
    const tracks = trackText(
      pages([
        null,
        [line('Day 1 in Goa')],
        [line('Day l in Goa', { ...title, x: 0.11 })],
        [line('Day 1 in Goa'), line('Beach time', { x: 0.1, y: 0.7, width: 0.5, height: 0.05 })],
        [line('Beach time', { x: 0.1, y: 0.7, width: 0.5, height: 0.05 })],
        null,
        null,
      ]),
      config,
    );
    expect(tracks.map((t) => [t.text, t.first, t.last, t.before, t.after, t.samples])).toEqual([
      ['Day 1 in Goa', 8, 23, 0, 30, 3],
      ['Beach time', 23, 30, 15, 38, 2],
    ]);
  });

  it('sees a line that grows word by word as one overlay revealed wordByWord', () => {
    const [track] = trackText(
      pages([
        [line('Three', title)],
        [line('Three things', title)],
        [line('Three things to do', title)],
        null,
        null,
      ]),
      config,
    );
    expect(track).toMatchObject({ text: 'Three things to do', wordByWord: true, samples: 3 });
  });

  it('drops low-confidence lines (an unsupported script) and tolerates one missed sample', () => {
    const tracks = trackText(
      pages([[line('???', title, 0.2)], [line('Hello')], null, [line('Hello')], null, null]),
      config,
    );
    expect(tracks.map((t) => [t.text, t.samples, t.last])).toEqual([['Hello', 2, 23]]);
  });

  it('drops interface chrome that stays the whole recording in a platform zone', () => {
    const chrome = line('@creator · Original audio', { x: 0.05, y: 0.88, width: 0.6, height: 0.04 });
    const tracks = trackText(
      pages(Array.from({ length: 10 }, (_, i) => (i < 4 ? [chrome, line('Title')] : [chrome]))),
      config,
    );
    expect(dropChrome(tracks, 10, config).map((t) => t.text)).toEqual(['Title']);
  });

  it('merges a static reel-long title across OCR noise and partial tail fragments without merging numbered steps', () => {
    const tracks = trackText(
      pages([
        [line('1 POV you have peak music taste.', { x: 0.14, y: 0.56, width: 0.72, height: 0.04 })],
        [line('1 POV you have peak music taste.', { x: 0.14, y: 0.56, width: 0.72, height: 0.04 })],
        null,
        [line('POV: You trave peak music taste', { x: 0.16, y: 0.56, width: 0.69, height: 0.04 })],
        [line('I poV: You have peak music taste.', { x: 0.14, y: 0.56, width: 0.72, height: 0.04 })],
        [line('peak music taste.', { x: 0.51, y: 0.56, width: 0.35, height: 0.03 })],
      ]),
      config,
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      text: 'poV: You have peak music taste.',
      first: 0,
      last: 38,
      samples: 5,
    });
  });
});

describe('edge refinement (the second method)', () => {
  it('finds the first frame by binary search over single frames', async () => {
    const asked: number[] = [];
    const present = async (frame: number) => {
      asked.push(frame);
      return frame >= 11;
    };
    expect(await refineEdge(8, 15, present)).toBe(11);
    expect(asked.length).toBeLessThanOrEqual(3);
  });

  it('matches a track on a frame by text and box', () => {
    expect(matchesTrack({ text: 'Day 1 in Goa', box: title }, [line('Day 1 in Goa')], config)).toBe(true);
    expect(matchesTrack({ text: 'Day 1 in Goa', box: title }, [line('Day 1')], config)).toBe(true);
    expect(
      matchesTrack(
        { text: 'Day 1 in Goa', box: title },
        [line('Paris', { x: 0, y: 0.9, width: 0.1, height: 0.05 })],
        config,
      ),
    ).toBe(false);
  });

  it('turns a track into an overlay with exact frames and a guessed look', () => {
    const [track] = trackText(
      pages([[line('FOLLOW FOR MORE')], [line('FOLLOW FOR MORE')], null, null]),
      config,
    );
    const overlay = overlayFromTrack(track!, { start: 3, end: 12, rate: FrameRates.fps30 }, newId());
    expect(overlay).toMatchObject({
      text: 'FOLLOW FOR MORE',
      role: 'cta',
      start: { value: 3 },
      duration: { value: 9 },
      slotId: null,
      appearance: { case: 'upper', align: 'center' },
      reveal: 'none',
      language: 'en',
    });
  });
});
