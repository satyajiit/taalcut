// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Timing to speech: phrases in four languages, number words, fallbacks, and following a ripple. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FrameRate,
  graphicCompositionSchema,
  newId,
  RationalTime,
  timelineSchema,
  type GraphicItem,
  type Timeline,
} from '@taalcut/core';
import { findPhrase, phraseTokens, type TimedWord } from '../../src/compositions/phrase-match';
import { planCompositions } from '../../src/workspace/fold/plan-compositions';
import { LEAD_FRAMES, resolveTiming, slotStarts, type TimingContext } from '../../src/compositions/timing';
import { rate, spokenTimeline } from './support';

const words = (text: string, start = 0, each = 10): TimedWord[] =>
  text
    .split(' ')
    .map((word, index) => ({ text: word, start: start + index * each, end: start + (index + 1) * each }));

const context = (
  spoken: readonly TimedWord[],
  language = 'en',
  slots = new Map<string, number>(),
): TimingContext => ({
  words: spoken,
  language,
  slots,
  rate,
  durationFrames: 300,
});

describe('phrase matching', () => {
  it('reads "fifty percent", "50 %" and "50%" alike in the four languages', () => {
    const fifty = ['50', '%'];
    for (const [text, language] of [
      ['fifty percent', 'en'],
      ['50 %', 'en'],
      ['50%', 'en'],
      ['Fifty per cent!', 'en'],
      ['cincuenta por ciento', 'es'],
      ['cinquenta por cento', 'pt-BR'],
      ['पचास प्रतिशत', 'hi'],
      ['५० %', 'hi'],
    ] as const)
      expect(phraseTokens(text, language), text).toEqual(fifty);
  });

  it('folds compound numbers, accents and Devanagari spelling variants', () => {
    expect(phraseTokens('twenty-one', 'en')).toEqual(['21']);
    expect(phraseTokens('one hundred and five', 'en')).toEqual(['105']);
    expect(phraseTokens('treinta y cinco', 'es')).toEqual(['35']);
    expect(phraseTokens('vinte e cinco', 'pt-BR')).toEqual(['25']);
    expect(phraseTokens('dos mil veintiséis', 'es')).toEqual(['2026']);
    expect(phraseTokens('twelve thousand five hundred', 'en')).toEqual(['12500']);
    expect(phraseTokens('12,500', 'en')).toEqual(['12500']);
    expect(phraseTokens('दो सौ', 'hi')).toEqual(['200']);
    expect(phraseTokens('पाँच', 'hi')).toEqual(phraseTokens('पांच', 'hi'));
    expect(phraseTokens('Canción', 'es')).toEqual(['cancion']);
    // Two numbers said apart stay two numbers.
    expect(phraseTokens('2 3', 'en')).toEqual(['2', '3']);
  });

  it('finds a phrase across caption words, by occurrence, or not at all', () => {
    const spoken = words('we grew fifty percent and then fifty percent again');
    expect(findPhrase(spoken, '50%', 1, 'en')).toEqual({ first: 2, last: 3 });
    expect(findPhrase(spoken, 'fifty percent', 2, 'en')).toEqual({ first: 6, last: 7 });
    expect(findPhrase(spoken, 'fifty percent', 3, 'en')).toBeNull();
    expect(findPhrase(spoken, 'sixty percent', 1, 'en')).toBeNull();
    expect(findPhrase(spoken, '!!!', 1, 'en')).toBeNull();
  });
});

describe('resolveTiming', () => {
  it('starts 6 frames before the phrase', () => {
    const spoken = words('three tips first light second sound third story', 30, 20);
    const timing = resolveTiming(
      { anchor: { kind: 'phrase', text: 'three tips', occurrence: 1 }, frames: 150, fallbackStart: 0 },
      context(spoken),
    );
    expect(timing).toEqual({ start: 30 - LEAD_FRAMES, end: 174, unmatched: [], matched: true });
  });

  it('falls back to where it was and reports what it could not find', () => {
    const timing = resolveTiming(
      { anchor: { kind: 'phrase', text: 'not said', occurrence: 1 }, frames: 120, fallbackStart: 40 },
      context(words('hello there')),
    );
    expect(timing).toEqual({ start: 40, end: 160, matched: false, unmatched: ['not said'] });
  });

  it('resolves slots and times, and never runs past the timeline', () => {
    const slot = newId<'TemplateSlot'>();
    const slots = new Map([[slot, 90]]);
    expect(
      resolveTiming(
        { anchor: { kind: 'slot', slotId: slot }, frames: 60, fallbackStart: 0 },
        context([], 'en', slots),
      ),
    ).toMatchObject({ start: 90, end: 150 });
    const late = resolveTiming(
      {
        anchor: { kind: 'time', at: RationalTime.of(9_500, FrameRate.of(1000)) },
        frames: 60,
        fallbackStart: 0,
      },
      context([]),
    );
    expect(late).toMatchObject({ start: 240, end: 300 });
    expect(
      resolveTiming(
        {
          anchor: { kind: 'slot', slotId: newId<'TemplateSlot'>() },
          frames: 30,
          fallbackStart: 12,
        },
        context([], 'en', slots),
      ).unmatched,
    ).toHaveLength(1);
  });

  it('finds each slot’s first frame on V1', () => {
    const timeline = spokenTimeline([[0, 30, 'hello']]);
    const starts = [...slotStarts(timeline).values()];
    expect(starts).toEqual([0, 90]);
  });
});

describe('planCompositions', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const copy = graphicCompositionSchema.parse({
    id: newId<'GraphicComposition'>(),
    version: 1,
    hash: sha('a made-up composition'),
    name: 'Counter',
    entry: 'index.html',
    files: [{ path: 'index.html', sha256: sha('<div></div>'), bytes: 11 }],
    variables: [],
    durationSeconds: 2,
    provenance: { model: { id: 'test-model', onDevice: true }, overlays: [], brief: null, createdAt: 1 },
    gate: {
      version: 'hfw1.1',
      passed: true,
      checkedAt: 1,
      hfLint: { errors: 0, warnings: 0 },
      checks: [],
      loweredTweens: 0,
    },
  });

  function withCounter(timeline: Timeline): Timeline {
    const item: GraphicItem = {
      type: 'graphic',
      id: newId<'TimelineItem'>(),
      anchor: { kind: 'phrase', text: 'fifty percent', occurrence: 1 },
      start: RationalTime.of(4, rate),
      duration: RationalTime.of(60, rate),
      placement: 'middle',
      styleKey: 'graphic',
      language: 'en',
      origin: 'agent',
      composition: { id: copy.id, hash: copy.hash, params: {} },
    };
    return timelineSchema.parse({
      ...timeline,
      tracks: [
        ...timeline.tracks,
        { kind: 'text', id: 'T1', name: 'Graphics', enabled: true, items: [item] },
      ],
      graphicCompositions: [copy],
    });
  }

  const spans = (timeline: Timeline) =>
    planCompositions(timeline, rate).planned.map((planned) => planned.span);

  it('matches anchors again on every compile, so a graphic follows its phrase after a ripple', () => {
    const before = withCounter(spokenTimeline([[10, 60, 'we grew fifty percent']]));
    // captionTrackOf gives each of the cue's four words 15 frames: "fifty" starts at 10 + 30.
    expect(spans(before)[0]).toEqual({ start: 40 - LEAD_FRAMES, end: 94 });
    // The speech moved 30 frames later (a ripple before it); the stored start didn't.
    const after = withCounter(spokenTimeline([[40, 60, 'we grew fifty percent']]));
    expect(spans(after)[0]?.start).toBe(70 - LEAD_FRAMES);
    // Without the phrase, the graphic stays where it was stored.
    const gone = withCounter(spokenTimeline([[10, 60, 'we grew a lot']]));
    expect(spans(gone)[0]).toEqual({ start: 4, end: 64 });
  });
});
