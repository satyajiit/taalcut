// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-C1: the listening stage's own rules: which events are effects and of what family, the effects on the cuts,
 * the cap on events, the move from candidate cuts to slots, and how it fails (never the breakdown).
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, FrameRates, RationalTime, templateListeningSchema, type SoundEvent } from '@taalcut/core';
import {
  keptEvents,
  LISTENING_UNAVAILABLE,
  listenToReel,
  reelListening,
  sfxAtCutsOf,
  sfxFamilyOf,
  slotListening,
  type BreakdownAudio,
} from '../src/index';
import {
  fakeEvent,
  fakeListener,
  missingModelListener,
  plannedListening,
  type CutPlan,
} from './helpers/listening-fakes';

const rate = FrameRates.fps30;
const frames = (list: readonly number[]) => list.map((frame) => RationalTime.of(frame, rate));
const audio = (listen?: BreakdownAudio['listen']): BreakdownAudio => ({
  beats: async () => {
    throw new Error('not called');
  },
  loudness: async () => {
    throw new Error('not called');
  },
  ...(listen ? { listen } : {}),
});
const tag = (kind: NonNullable<SoundEvent['kind']>, term: string) => ({
  kind,
  tags: [{ term, kind, z: 2.4 }],
});

describe('sfxFamilyOf', () => {
  it('reads a tagged event by its kind, and a music or voice onset only when it stands out', () => {
    expect(sfxFamilyOf(fakeEvent(1, tag('whoosh', 'a fast air whoosh')))).toBe('whoosh');
    expect(sfxFamilyOf(fakeEvent(1, tag('riser', 'an uplifter sweep')))).toBe('riser');
    expect(sfxFamilyOf(fakeEvent(1, tag('hit', 'a deep cinematic boom')))).toBe('impact');
    expect(sfxFamilyOf(fakeEvent(1, tag('ui', 'a mouse click')))).toBe('hit');
    expect(sfxFamilyOf(fakeEvent(1, { ...tag('drum', 'a kick drum'), exposed: true }))).toBe('hit');
    expect(sfxFamilyOf(fakeEvent(1, { ...tag('drum', 'a kick drum'), exposed: false }))).toBeNull();
    expect(sfxFamilyOf(fakeEvent(1, tag('voice', 'a person talking')))).toBeNull();
  });

  it('reads an untagged event by its shape: a long build a riser, a short one a whoosh, an exposed hit', () => {
    expect(sfxFamilyOf(fakeEvent(1, { shape: 'swell', riseMs: 1400 }))).toBe('riser');
    expect(sfxFamilyOf(fakeEvent(1, { shape: 'swell', riseMs: 300 }))).toBe('whoosh');
    expect(sfxFamilyOf(fakeEvent(1, { band: 'low' }))).toBe('impact');
    expect(sfxFamilyOf(fakeEvent(1))).toBe('hit');
    expect(sfxFamilyOf(fakeEvent(1, { exposed: false }))).toBeNull();
  });
});

const PLAN: readonly CutPlan[] = [
  { status: 'ok', offsetMs: 20, event: tag('whoosh', 'a whip pan whoosh transition') },
  { status: 'near', offsetMs: -80, event: { band: 'low' } },
  { status: 'swell', offsetMs: 180, event: { shape: 'swell', riseMs: 1200 } },
  { status: 'off', offsetMs: 180 },
  { status: 'none' },
  { status: 'ok', offsetMs: 0, event: tag('voice', 'a spoken word') },
];

describe('sfxAtCutsOf', () => {
  it('lists the cuts an effect answers, with its family, offset and words, and nothing else', () => {
    const heard = plannedListening(frames([30, 60, 90, 120, 150, 180]), (i) => PLAN[i]!);
    expect(sfxAtCutsOf(heard)).toEqual([
      { cutIndex: 0, family: 'whoosh', offsetMs: 20, soundHint: 'a whip pan whoosh transition' },
      { cutIndex: 1, family: 'impact', offsetMs: -80 },
      { cutIndex: 2, family: 'riser', offsetMs: 180 },
    ]);
  });
});

describe('keptEvents', () => {
  it('keeps every event that answers a cut, then the most prominent, in time order', () => {
    const heard = plannedListening(
      frames([30, 60]),
      () => ({ status: 'ok', offsetMs: 0, event: { prominenceDb: 1 } }),
      {
        extra: [5, 6, 7, 8].map((t) => fakeEvent(t, { prominenceDb: t })),
      },
    );
    const kept = keptEvents(heard.events, heard.cutSync, 4);
    expect(kept.map((event) => RationalTime.toSeconds(event.at))).toEqual([1, 2, 7, 8]);
  });
});

describe('reelListening', () => {
  it('times each item at its cut’s exact frame, caps the events and derives the effects', () => {
    const cuts = [30, 60, 90];
    const heard = plannedListening(frames(cuts), (i) => PLAN[i]!, {
      extra: Array.from({ length: 500 }, (_, k) => fakeEvent(4 + k / 100, { prominenceDb: 3 })),
    });
    const kept = reelListening(heard, cuts, rate)!;
    expect(templateListeningSchema.safeParse(kept).success).toBe(true);
    expect(kept.events).toHaveLength(400);
    expect(kept.cutSync.items.map((item) => item.at)).toEqual(frames(cuts));
    expect(kept.sfxAtCuts.map((effect) => effect.family)).toEqual(['whoosh', 'impact', 'riser']);
  });

  it('keeps the reel’s critique metrics that fit (K1), leaving out a bad name or value', () => {
    const cuts = [30, 60];
    const heard = plannedListening(frames(cuts), (i) => PLAN[i]!);
    const kept = reelListening(
      { ...heard, critiqueMetrics: { lufsI: -13.2, musicFrac: null, 'bad id': 1, onsetRate: Number.NaN } },
      cuts,
      rate,
    )!;
    expect(kept.critiqueMetrics).toEqual({ lufsI: -13.2, musicFrac: null });
  });
});

describe('slotListening', () => {
  it('moves each kept cut under its slot and drops a cut the Analyst rejected', () => {
    const cuts = [30, 60, 90, 120];
    const heard = reelListening(
      plannedListening(frames(cuts), (i) => PLAN[i]!),
      cuts,
      rate,
    )!;
    // The dispute at 60 was rejected: slots start at 0, 30, 90 and 120.
    const slotted = slotListening(heard, [0, 30, 90, 120], rate);
    expect(slotted.cutSync.items.map((item) => [item.cutIndex, item.status])).toEqual([
      [1, 'ok'],
      [2, 'swell'],
      [3, 'off'],
    ]);
    expect(slotted.sfxAtCuts.map((effect) => [effect.cutIndex, effect.family])).toEqual([
      [1, 'whoosh'],
      [2, 'riser'],
    ]);
    expect(slotted.cutSync).toMatchObject({
      cutsWithoutHit: [3],
      okShare: 0.333,
      nearShare: 0.333,
      medianOffsetMs: 180,
    });
    expect(templateListeningSchema.safeParse(slotted).success).toBe(true);
  });
});

describe('listenToReel', () => {
  const input = {
    path: '/reel.mp4',
    cuts: [90, 30, 60, 30],
    rate,
    beatMap: null,
    hasAudio: true,
    signal: new AbortController().signal,
  };

  it('asks for every candidate cut once, in order, to the millisecond, with the picture’s rate', async () => {
    const { listen, calls } = fakeListener(() => ({ status: 'ok', offsetMs: 10 }));
    const outcome = await listenToReel(audio(listen), { ...input, cuts: [91, 30, 60, 30] });
    expect(calls[0]!.cuts).toEqual(
      [1000, 2000, 3033].map((value) => RationalTime.of(value, FrameRate.of(1000))),
    );
    expect(calls[0]!.frameRate).toEqual(rate);
    expect(outcome.listening?.cutSync.items.map((item) => item.at)).toEqual(frames([30, 60, 91]));
    expect(outcome.warning).toBeUndefined();
    expect(outcome.listening?.cutSync.items).toHaveLength(3);
  });

  it('without the models, or when the listener throws, has no listening and warns', async () => {
    const logged: string[] = [];
    const missing = await listenToReel(audio(missingModelListener()), {
      ...input,
      log: (line) => logged.push(line),
    });
    expect(missing).toEqual({ listening: null, warning: LISTENING_UNAVAILABLE });
    expect(logged[0]).toContain('audio.listen_model_missing');
    const thrown = await listenToReel(
      audio(async () => {
        throw new Error('bug');
      }),
      input,
    );
    expect(thrown).toEqual({ listening: null, warning: LISTENING_UNAVAILABLE });
  });

  it('a reel without sound has none; analysers that can’t listen leave it out', async () => {
    const { listen, calls } = fakeListener(() => ({ status: 'none' }));
    expect(await listenToReel(audio(listen), { ...input, hasAudio: false })).toEqual({ listening: null });
    expect(calls).toHaveLength(0);
    expect(await listenToReel(audio(), input)).toEqual({});
  });
});
