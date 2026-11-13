// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-C2: the sound line the Analyst reads in templates.breakdown's summary. */
import { describe, expect, it } from 'vitest';
import { FrameRates, RationalTime, type SoundSection, type TemplateListening } from '@taalcut/core';
import { analystSoundLine, reelListening } from '../src/index';
import { fakeEvent, ms, plannedListening, type CutPlan } from './helpers/listening-fakes';

const rate = FrameRates.fps30;
const CUTS = [45, 120, 210, 300, 390, 480];
const PLAN: readonly CutPlan[] = [
  { status: 'ok', offsetMs: 12, event: { shape: 'swell', riseMs: 320 } },
  { status: 'ok', offsetMs: -20, event: { band: 'low' } },
  { status: 'near', offsetMs: 70, event: { shape: 'swell', riseMs: 900 } },
  { status: 'ok', offsetMs: 8, event: { band: 'low' } },
  { status: 'off', offsetMs: 190 },
  { status: 'none' },
];

const section = (start: number, end: number, label: string, silent = false): SoundSection => ({
  start: ms(start),
  end: ms(end),
  label,
  genre: [],
  mood: [],
  instruments: [],
  ambience: [],
  voice: [],
  presence: null,
  lufs: silent ? null : -15,
  silent,
});

function listening(): TemplateListening {
  const heard = plannedListening(
    CUTS.map((frame) => RationalTime.of(frame, rate)),
    (i) => PLAN[i]!,
    {
      seconds: 20,
      extra: Array.from({ length: 30 }, (_, k) => fakeEvent(0.3 + k * 0.6, { exposed: false })),
    },
  );
  return reelListening(
    {
      ...heard,
      sections: [
        section(0, 4, 'soft ambient pad, warm'),
        section(4, 15, 'upbeat electronic music, synth bass | voice: a woman speaking over it'),
        section(20, 21, 'a very long label for a short section that the line never names at all'),
        section(15, 17, 'silence', true),
        section(17, 20, 'cinematic orchestral hit'),
      ],
    },
    CUTS,
    rate,
  )!;
}

describe('analystSoundLine', () => {
  it('says the key, tempo, how busy the sound is, the effects on the cuts and the longest sections', () => {
    expect(analystSoundLine(listening())).toMatchInlineSnapshot(
      `"Sound: A minor, 98 BPM; moderate sound design (1.8 sounds/s); effects on 4 of 6 cuts (1 whoosh, 1 riser, 2 impact); sections 0–4 s "soft ambient pad, warm" then 4–15 s "upbeat electronic music, synth bass"."`,
    );
  });

  it('is short enough for an 8k-context model', () => {
    expect(analystSoundLine(listening())!.length).toBeLessThanOrEqual(240);
  });

  it('names a weak pulse and a reel without effects, and says nothing when nothing was heard', () => {
    const base = listening();
    const quiet: TemplateListening = {
      ...base,
      measures: { ...base.measures, key: null, tempo: { ...base.measures.tempo!, confidence: 'weak' } },
      sfxAtCuts: [],
      sections: [],
    };
    expect(analystSoundLine(quiet)).toMatchInlineSnapshot(
      `"Sound: 98 BPM (weak pulse); moderate sound design (1.8 sounds/s); no effects on its 6 cuts."`,
    );
    const long = {
      ...quiet,
      sections: [section(0, 20, 'a very long label for a section of sound, cut at a word')],
    };
    expect(analystSoundLine(long)).toContain(
      'sections 0–20 s "a very long label for a section of sound, cut…"',
    );
    expect(analystSoundLine(null)).toBeNull();
    expect(analystSoundLine(undefined)).toBeNull();
  });
});
