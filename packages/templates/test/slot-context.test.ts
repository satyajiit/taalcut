// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Slot context (LRN1-CTX): which on-screen text and speech each resolved slot gets, in what order, where it
 * sits on the beat, and the caps that keep a long reel inside the model's context.
 */
import { describe, expect, it } from 'vitest';
import { clip, levelFor } from '../src/breakdown/slot-context-budget';
import { SLOT_CONTEXT_LIMITS, slotContextLimitsFor, slotContextShare } from '../src/breakdown/slot-context';
import { SMALLEST_WINDOW } from '../src/breakdown/slot-context-pages';
import { contextDraft, contextsOf, longDraft } from './helpers/context-draft';

const TOP = { x: 0.1, y: 0.05, width: 0.8, height: 0.1 };
const BOTTOM = { x: 0.1, y: 0.8, width: 0.8, height: 0.1 };

describe('on-screen text', () => {
  it('gives each slot the text over it in reading order, with role, a rough position and any reveal', () => {
    const draft = contextDraft([
      { text: 'follow for part 2', start: 0, end: 30, box: BOTTOM, role: 'cta', reveal: 'pop' },
      { text: '3 mistakes beginners make', start: 0, end: 30, box: TOP, role: 'title' },
      { text: 'left label', start: 0, end: 30, box: { x: 0, y: 0.4, width: 0.2, height: 0.05 } },
    ]);
    expect(contextsOf(draft)[0]?.onScreen).toEqual([
      { text: '3 mistakes beginners make', role: 'title', position: 'top-center' },
      { text: 'left label', role: 'caption', position: 'middle-left' },
      { text: 'follow for part 2', role: 'cta', position: 'bottom-center', reveal: 'pop' },
    ]);
  });

  it('says what a text is drawn on when the breakdown measured it surely (FIX-HOOK), never plain text', () => {
    const draft = contextDraft([
      {
        text: 'are you there?',
        start: 0,
        end: 30,
        box: TOP,
        role: 'label',
        design: { kind: 'chatBubble', confidence: 0.9 },
      },
      {
        text: 'maybe a pill',
        start: 0,
        end: 30,
        box: BOTTOM,
        role: 'label',
        design: { kind: 'pill', confidence: 0.3 },
      },
      { text: 'just words', start: 30, end: 45, design: { kind: 'plain', confidence: 0.95 } },
    ]);
    const [first, second] = contextsOf(draft);
    expect(first?.onScreen).toEqual([
      { text: 'are you there?', role: 'label', position: 'top-center', shape: 'chatBubble' },
      { text: 'maybe a pill', role: 'label', position: 'bottom-center' },
    ]);
    expect(second?.onScreen).toEqual([{ text: 'just words', role: 'caption', position: 'top-center' }]);
  });

  it('marks text carried across a cut as earlier, and ignores a few frames of spill', () => {
    // Slots: 0–30, 30–45, 45–90, 90–120. The title spans 32–52; the caption ends 2 frames into slot 3.
    const draft = contextDraft([
      { text: 'Day 1 in Goa', start: 32, end: 52, role: 'title' },
      { text: 'first stop', start: 50, end: 92, box: BOTTOM },
    ]);
    const slots = contextsOf(draft);
    expect(slots.map((slot) => slot.onScreen?.map((track) => [track.text, track.earlier]))).toEqual([
      undefined,
      [['Day 1 in Goa', undefined]],
      [
        ['Day 1 in Goa', true],
        ['first stop', undefined],
      ],
      undefined,
    ]);
    // A slot with nothing to say leaves the field out, rather than sending an empty list to the model.
    expect(Object.keys(slots[0] ?? { onScreen: [] })).not.toContain('onScreen');
  });

  it('keeps a text once, and drops a typewriter state the full line contains', () => {
    const draft = contextDraft([
      { text: '3 mistakes', start: 0, end: 10, reveal: 'typewriter' },
      { text: '3 Mistakes  beginners make', start: 10, end: 30, reveal: 'typewriter' },
      { text: 'SALE', start: 0, end: 15, box: BOTTOM },
      { text: 'sale', start: 15, end: 30, box: BOTTOM },
    ]);
    expect(contextsOf(draft)[0]?.onScreen?.map((track) => track.text)).toEqual([
      '3 Mistakes  beginners make',
      'SALE',
    ]);
  });

  it('keeps at most four tracks per slot', () => {
    const lines = Array.from({ length: 6 }, (_, index) => ({
      text: `line ${index}`,
      start: 0,
      end: 30,
      box: { x: 0.1, y: 0.1 * index, width: 0.8, height: 0.05 },
    }));
    expect(contextsOf(contextDraft(lines))[0]?.onScreen?.map((track) => track.text)).toEqual([
      'line 0',
      'line 1',
      'line 2',
      'line 3',
    ]);
  });
});

describe('speech', () => {
  it('splits a segment that spans a cut, each word in exactly one slot', () => {
    // 9 words over 1.0–2.5 s: midpoints every 1/6 s from 1.083 s; the cut at frame 45 is 1.5 s.
    const draft = contextDraft(
      [],
      [{ text: 'so the first mistake is buying the wrong shoes', startMs: 1000, endMs: 2500 }],
    );
    expect(contextsOf(draft).map((slot) => slot.speech)).toEqual([
      undefined,
      'so the first',
      'mistake is buying the wrong shoes',
      undefined,
    ]);
  });

  it('places a script written without spaces at its segment midpoint', () => {
    const draft = contextDraft([], [{ text: '今日はいい天気', startMs: 0, endMs: 1400 }]);
    expect(contextsOf(draft).map((slot) => slot.speech)).toEqual([
      '今日はいい天気',
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('position', () => {
  it('gives the length in seconds and whether the slot starts on a beat', () => {
    const slots = contextsOf(contextDraft([]));
    expect(slots.map((slot) => [slot.seconds, slot.onBeat])).toEqual([
      [1, true],
      [0.5, true],
      [1.5, true],
      [1, true],
    ]);
  });

  it('leaves onBeat out without a beat map', () => {
    expect(contextsOf(contextDraft([], [], { beats: false })).every((slot) => !('onBeat' in slot))).toBe(
      true,
    );
  });
});

describe('bounds', () => {
  it('cuts a slot to its caps, at a word boundary, with an ellipsis', () => {
    const long = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');
    const draft = contextDraft([{ text: long, start: 0, end: 30 }], [{ text: long, startMs: 0, endMs: 900 }]);
    const [first] = contextsOf(draft);
    const text = first?.onScreen?.[0]?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(SLOT_CONTEXT_LIMITS.onScreenChars);
    expect(text.endsWith('…')).toBe(true);
    expect(text.slice(0, -1)).toMatch(/word\d+$/);
    expect(first?.speech?.length).toBeLessThanOrEqual(SLOT_CONTEXT_LIMITS.speechChars);
  });

  it('holds a 60-slot reel to the whole cap, every slot keeping its share', () => {
    const draft = longDraft({ slots: 60, tracks: 4, chars: 200, words: 80 });
    const slots = contextsOf(draft);
    const chars = (slot: (typeof slots)[number]) =>
      (slot.onScreen ?? []).reduce((sum, track) => sum + track.text.length, 0) + (slot.speech?.length ?? 0);
    expect(slots).toHaveLength(60);
    expect(slots.reduce((sum, slot) => sum + chars(slot), 0)).toBeLessThanOrEqual(
      SLOT_CONTEXT_LIMITS.totalChars,
    );
    expect(slots.every((slot) => (slot.onScreen?.length ?? 0) >= 1 && slot.speech !== undefined)).toBe(true);
  });

  it("scales the text caps with the model's window: half at 8,192, three quarters at 16,384, whole from 32,768", () => {
    expect([8_192, 16_384, 32_768, 200_000, 4_096].map(slotContextShare)).toEqual([0.5, 0.75, 1, 1, 0.5]);
    // An unknown window is the smallest a local tier runs: 12,288, with its cache at q8_0.
    expect(slotContextShare(undefined)).toBe(slotContextShare(SMALLEST_WINDOW));
    expect(slotContextLimitsFor(12_288)).toMatchObject({
      onScreenChars: 103,
      speechChars: 129,
      totalChars: 1163,
    });
    expect(slotContextLimitsFor(8_192)).toMatchObject({
      onScreenChars: 80,
      speechChars: 100,
      totalChars: 900,
    });
    expect(slotContextLimitsFor(16_384)).toMatchObject({
      onScreenChars: 120,
      speechChars: 150,
      totalChars: 1350,
    });
    expect(slotContextLimitsFor(32_768)).toEqual(SLOT_CONTEXT_LIMITS);
    // A slot keeps the start of its text at a small window.
    const draft = longDraft({ slots: 2, tracks: 4, chars: 200, words: 80 });
    const limits = slotContextLimitsFor(8_192);
    for (const slot of contextsOf(draft, limits)) {
      const onScreen = (slot.onScreen ?? []).reduce((sum, track) => sum + track.text.length, 0);
      expect(onScreen).toBeLessThanOrEqual(limits.onScreenChars);
      expect(slot.speech?.length ?? 0).toBeLessThanOrEqual(limits.speechChars);
    }
  });

  it('leaves short texts whole when long ones are trimmed', () => {
    const limits = { ...SLOT_CONTEXT_LIMITS, totalChars: 100 };
    const draft = contextDraft([
      { text: 'Hi', start: 0, end: 30 },
      { text: 'a long caption '.repeat(10), start: 30, end: 45 },
      { text: 'another long caption '.repeat(10), start: 45, end: 90 },
    ]);
    const slots = contextsOf(draft, limits);
    const texts = slots.map((slot) => slot.onScreen?.[0]?.text ?? '');
    expect(texts[0]).toBe('Hi');
    expect(texts.reduce((sum, text) => sum + text.length, 0)).toBeLessThanOrEqual(100);
    // Both long ones are cut to the same level, (100 - 2) / 2 = 49, each at a word boundary.
    for (const text of texts.slice(1, 3)) {
      expect(text.length).toBeLessThanOrEqual(49);
      expect(text.length).toBeGreaterThan(32);
      expect(text.endsWith('…')).toBe(true);
    }
  });
});

describe('budget helpers', () => {
  it('clips at a word boundary unless that wastes more than a third', () => {
    expect(clip('short', 10)).toBe('short');
    expect(clip('one two three four five', 16)).toBe('one two three…');
    // Dropping "thr" would waste more than a third of the room: cut mid-word instead.
    expect(clip('one two three four', 12)).toBe('one two thr…');
    expect(clip('abcdefghijklmnop', 8)).toBe('abcdefg…');
    expect(clip('abc', 1)).toBe('');
    // Never half of a surrogate pair.
    expect(clip('ab😀cdef', 4)).toBe('ab…');
  });

  it('finds the largest level that fits', () => {
    expect(levelFor([10, 20], 40)).toBe(Number.POSITIVE_INFINITY);
    expect(levelFor([10, 50, 50], 70)).toBe(30);
    expect(levelFor([100, 100], 50)).toBe(25);
    expect(levelFor([0, 0, 90], 30)).toBe(30);
  });
});

describe('camera (FRM1-MOT)', () => {
  const still = [0, 0.1, 0, 0, 0, 0, 0.9, 150, 0.001];
  const pan = [0, 0.1, -0.012, 0, 0, 0, 0.9, 150, 0.001];

  it('says each slot’s measured move in words, and nothing where the breakdown has none', () => {
    const base = contextDraft([]);
    // Slots 0–30, 30–45, 45–90, 90–120: still, a pan right, unmeasured, unmeasured.
    const draft = {
      ...base,
      camera: {
        version: 1,
        width: 384,
        height: 216,
        segments: [
          { start: 0, end: 30, pairs: Array.from({ length: 9 }, (_, i) => [3 * (i + 1), ...still.slice(1)]) },
          { start: 30, end: 45, pairs: Array.from({ length: 6 }, (_, i) => [32 + 2 * i, ...pan.slice(1)]) },
        ],
      },
    };
    expect(contextsOf(draft).map((context) => context.camera)).toEqual([
      'static: the camera holds still (a subject may move)',
      'pan right',
      undefined,
      undefined,
    ]);
  });
});
