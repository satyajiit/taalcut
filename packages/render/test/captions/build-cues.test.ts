// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Cues per language (SPEC section 14, P2-M5): en, hi, es, pt-BR and Hinglish. */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FrameRate,
  newId,
  RationalTime,
  type CaptionCue,
  type CaptionWord,
  type Transcript,
} from '@taalcut/core';
import { buildCaptionCues, captionWordsFromPlan, minCueFrames } from '../../src/captions/cues';
import { layoutCue } from '../../src/captions/layout';
import type { DetailedTextMeasurer } from '../../src/captions/measure';
import { CLASSIC_STYLE } from '../../src/captions/style';
import { graphemes } from '../../src/captions/text';
import { planTimeline } from '../../src/plan/render-plan';
import { safeRectFor } from '../../src/presets/presets.v1';
import { testMeasurer } from '../support/fonts';
import { makeTimeline } from '../support/timeline';

const rate = FrameRate.of(30);
const safe = safeRectFor([]);
let measurer: DetailedTextMeasurer;

beforeAll(async () => {
  measurer = await testMeasurer();
});

/** Words one after another, `each` frames long, with `gap` frames between them. */
function wordsOf(text: string, start = 0, each = 20, gap = 0): CaptionWord[] {
  return text.split(' ').map((word, index) => ({
    text: word,
    range: {
      start: RationalTime.of(start + index * (each + gap), rate),
      duration: RationalTime.of(each, rate),
    },
    confidence: 0.9,
  }));
}

const cueTexts = (cues: readonly CaptionCue[]) =>
  cues.map((cue) => cue.words.map((word) => word.text).join(' '));
const frames = (cue: CaptionCue) => RationalTime.toFrames(cue.range.duration, rate);
const build = (words: CaptionWord[], language: string, style = CLASSIC_STYLE) =>
  buildCaptionCues(words, style, measurer, safe, { language, rate, durationFrames: 10_000 });

/** Every word of the input appears once, whole and in order, so no grapheme was ever split. */
function expectWholeWords(cues: readonly CaptionCue[], words: readonly CaptionWord[]) {
  const out = cues.flatMap((cue) => cue.words.map((word) => word.text));
  expect(out).toEqual(words.map((word) => word.text));
  for (const word of out) expect(graphemes(word).join('')).toBe(word);
}

function expectInvariants(cues: readonly CaptionCue[], style = CLASSIC_STYLE, language = 'en') {
  for (const cue of cues) {
    expect(frames(cue)).toBeGreaterThanOrEqual(minCueFrames(rate));
    const text = cue.words.map((word) => word.text).join(' ');
    if (cue.words.length > 1) {
      expect(cue.words.length).toBeLessThanOrEqual(style.maxWords);
      expect(layoutCue(text, style, measurer, safe, language).lines.length).toBeLessThanOrEqual(
        style.maxLines,
      );
    }
  }
}

describe('buildCaptionCues', () => {
  it('English: ends cues at sentence punctuation and at the word limit', () => {
    const words = wordsOf('This is the first one. And here comes the second sentence now');
    const cues = build(words, 'en');
    expect(cueTexts(cues)).toEqual([
      'This is the first',
      'one.',
      'And here comes the',
      'second sentence now',
    ]);
    expectWholeWords(cues, words);
    expectInvariants(cues);
  });

  it('Hindi: breaks at the danda, keeps conjuncts and matras whole', () => {
    const words = wordsOf('मैंने क्षमा माँगी। ज्ञान और श्रम से कर्क राशि ज़िंदगी बदलती है॥ फिर मिलेंगे');
    const cues = build(words, 'hi', { ...CLASSIC_STYLE, font: 'mukta', maxWords: 5 });
    expect(cueTexts(cues)[0]).toBe('मैंने क्षमा माँगी।');
    expect(cueTexts(cues).some((text) => text.endsWith('है॥'))).toBe(true);
    expectWholeWords(cues, words);
    expectInvariants(cues, { ...CLASSIC_STYLE, font: 'mukta', maxWords: 5 }, 'hi');
  });

  it('Spanish: ¿ and ¡ open a cue', () => {
    const words = wordsOf('Hola amigo ¿cómo estás? ¡Qué bien!');
    const cues = build(words, 'es');
    expect(cueTexts(cues)).toEqual(['Hola amigo', '¿cómo estás?', '¡Qué bien!']);
    expectInvariants(cues, CLASSIC_STYLE, 'es');
  });

  it('Portuguese: a pause over 300 ms ends a cue', () => {
    const first = wordsOf('Não sei se', 0, 8);
    const second = wordsOf('você vem amanhã', 24 + 10, 8);
    const cues = build([...first, ...second], 'pt-BR');
    expect(cueTexts(cues)).toEqual(['Não sei se', 'você vem amanhã']);
    expectInvariants(cues, CLASSIC_STYLE, 'pt-BR');
  });

  it('Hinglish: lines stay within the safe width at a large size', () => {
    const style = { ...CLASSIC_STYLE, sizePx: 120, maxLines: 1, maxWords: 8 };
    const words = wordsOf('Yeh video bahut अच्छा hai aur मज़ा bhi aaya');
    const cues = build(words, 'hi', style);
    expect(cues.length).toBeGreaterThan(2);
    expectWholeWords(cues, words);
    expectInvariants(cues, style, 'hi');
  });

  it('a short cue borrows from the gap after it, else merges with its neighbour', () => {
    // "Hi." lasts 4 frames, then 30 frames of silence: it borrows up to 18 frames.
    const borrowed = build([...wordsOf('Hi.', 0, 4), ...wordsOf('Then more words here', 34, 8)], 'en');
    expect(frames(borrowed[0]!)).toBe(minCueFrames(rate));
    // "Yes." lasts 4 frames and the next cue starts at once: they merge.
    const merged = build([...wordsOf('Yes.', 0, 4), ...wordsOf('Right away now', 4, 8)], 'en');
    expect(cueTexts(merged)[0]).toBe('Yes. Right away now');
    expectInvariants(merged);
  });

  it('uses the given cue ids, and produces cues core accepts', () => {
    let n = 0;
    const ids = Array.from({ length: 4 }, () => newId<'CaptionCue'>());
    const cues = buildCaptionCues(wordsOf('one two three four five six'), CLASSIC_STYLE, measurer, safe, {
      language: 'en',
      rate,
      newCueId: () => ids[n++]!,
    });
    expect(cues.map((cue) => cue.id)).toEqual(ids.slice(0, cues.length));
  });
});

describe('captionWordsFromPlan', () => {
  it('maps source words through each clip, drops unused ones and skips muted clips', () => {
    const ms = FrameRate.of(1000);
    const timeline = makeTimeline({
      items: [
        { frames: 30, sourceStart: 30 },
        { frames: 30, sourceStart: 0, muted: true },
        { frames: 30, sourceStart: 60 },
      ],
    });
    const plan = planTimeline(timeline);
    if (!plan.ok) throw new Error(plan.error.code);
    const [first, second, third] = plan.value.visuals;
    const transcript = (words: [string, number, number][]): Transcript => ({
      version: 1,
      language: 'en',
      engine: 'whisper',
      model: 'test',
      local: true,
      wordTiming: 'native',
      segments: [
        {
          text: words.map(([text]) => text).join(' '),
          range: { start: RationalTime.of(0, ms), duration: RationalTime.of(10_000, ms) },
          language: 'en',
          words: words.map(([text, start, duration]) => ({
            text,
            range: { start: RationalTime.of(start, ms), duration: RationalTime.of(duration, ms) },
          })),
        },
      ],
    });
    const transcripts = new Map([
      // Clip 1 uses source 1.0–2.0 s: "before" is outside, "inside" starts at 1.5 s → frame 15.
      [
        first!.assetId,
        transcript([
          ['before', 500, 300],
          ['inside', 1500, 300],
          ['after', 2200, 200],
        ]),
      ],
      [second!.assetId, transcript([['muted', 0, 500]])],
      // Clip 3 uses source 2.0–3.0 s from frame 60: "late" at 2.1 s → frame 63.
      [third!.assetId, transcript([['late', 2100, 400]])],
    ]);
    const words = captionWordsFromPlan(plan.value, transcripts);
    expect(
      words.map((word) => [
        word.text,
        RationalTime.toFrames(word.range.start, rate),
        RationalTime.toFrames(word.range.duration, rate),
      ]),
    ).toEqual([
      ['inside', 15, 9],
      ['late', 63, 12],
    ]);
  });

  it('places a word where a speed ramp plays it, not where the mean speed would', () => {
    const ms = FrameRate.of(1000);
    const speed = {
      curve: 'linear' as const,
      points: [
        { at: RationalTime.of(0, rate), speed: 0.5 },
        { at: RationalTime.of(60, rate), speed: 2 },
      ],
    };
    const plan = planTimeline(
      makeTimeline({ items: [{ frames: 60, sourceStart: 0, mediaFrames: 120, speed }] }),
    );
    if (!plan.ok) throw new Error(plan.error.code);
    const transcript: Transcript = {
      version: 1,
      language: 'en',
      engine: 'whisper',
      model: 'test',
      local: true,
      wordTiming: 'native',
      segments: [
        {
          text: 'peak',
          range: { start: RationalTime.of(0, ms), duration: RationalTime.of(3_000, ms) },
          language: 'en',
          // 30 frames into a 0.5× → 2× ramp over 60 frames, 26.25 frames of source have played (0.875 s).
          words: [
            { text: 'peak', range: { start: RationalTime.of(875, ms), duration: RationalTime.of(100, ms) } },
          ],
        },
      ],
    };
    const words = captionWordsFromPlan(plan.value, new Map([[plan.value.visuals[0]!.assetId, transcript]]));
    // The mean speed (1.25) put it at frame 21.
    expect(words.map((word) => [word.text, RationalTime.toFrames(word.range.start, rate)])).toEqual([
      ['peak', 30],
    ]);
  });
});
