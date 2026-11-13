// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { rollClipLoop } from '#content/reels';
import { SAMPLE_ROLL } from '#components/showcase/auto-pick/roll';
import { framesOf } from '#components/showcase/frames';
import { SHOWCASE_HINTS } from '#components/showcase/hints';
import {
  FORMATS,
  LANGUAGES,
  STARTERS,
  startersIn,
  startersInOneLanguage,
} from '#components/showcase/templates/starters';
import {
  clipRate,
  DEFAULT_ROLL,
  fillWords,
  pickWords,
  ROLLS,
  rollById,
  SHOT_NEEDS,
  slotIndexAt,
  stillOf,
  templateReel,
  templateSlots,
} from '#components/showcase/templates/template';

const reel = templateReel();
const slots = templateSlots(reel);

describe('the templates page’s template', () => {
  it('is the airport reel’s own breakdown: 9 slots end to end on its music beats', () => {
    expect(reel.id).toBe('airport');
    expect(reel.timing).toBe('breakdown');
    expect(slots).toHaveLength(9);
    expect(SHOT_NEEDS).toHaveLength(slots.length);
    expect(slots[0]?.start).toBe(0);
    for (const [i, s] of slots.entries()) {
      expect(s.length, `slot ${s.n}`).toBeGreaterThan(0);
      if (i > 0) expect(s.start).toBeCloseTo(slots[i - 1]?.end ?? -1, 5);
    }
    expect(slots.at(-1)?.end).toBeCloseTo(reel.durationSec, 2);
    expect(reel.beats.length).toBe(24);
  });

  it('says what each slot wants as a kind of shot, never one trip’s subject, in a few words', () => {
    const subjects =
      /airport|terminal|gate|plane|flight|boarding|runway|wing|vietnam|temple|lantern|neon|jungle|resort|arches|baggage/i;
    expect(new Set(SHOT_NEEDS).size).toBe(SHOT_NEEDS.length);
    for (const need of SHOT_NEEDS) {
      expect(need).not.toMatch(subjects);
      expect(need.length, need).toBeLessThanOrEqual(24);
    }
    expect(SHOT_NEEDS[0]).toMatch(/to open$/);
    expect(SHOT_NEEDS.at(-1)).toMatch(/to close$/);
  });
});

describe('the camera rolls that fill it', () => {
  it('fill every slot from the owner’s own clips, each with its frames and its loop', () => {
    const own = new Set(SAMPLE_ROLL.map((c) => c.id));
    for (const roll of ROLLS.filter((r) => r.picks.length > 0)) {
      expect(roll.picks, roll.id).toHaveLength(slots.length);
      expect(new Set(roll.picks.map((p) => p.clipId)).size, roll.id).toBe(slots.length);
      for (const pick of roll.picks) {
        expect(own.has(pick.clipId), pick.clipId).toBe(true);
        expect(framesOf(pick.clipId).length, pick.clipId).toBeGreaterThan(0);
        expect(rollClipLoop(pick.clipId).length, pick.clipId).toBeGreaterThan(0);
        expect(stillOf(pick.clipId)).toBeTypeOf('number');
      }
    }
  });

  it('open on the Vietnam trip, nine of its clips, saying how sure where a clip fits less well', () => {
    const vietnam = rollById('vietnam');
    expect(DEFAULT_ROLL).toBe('vietnam');
    expect(vietnam.label).toBe('Vietnam trip');
    expect(vietnam.picks.every((p) => p.clipId.startsWith('vietnam-'))).toBe(true);
    const unsure = vietnam.picks.filter((p) => p.sure !== 'high');
    expect(unsure.length).toBeGreaterThan(0);
    expect(unsure.length).toBeLessThan(vietnam.picks.length / 2);
    // The held slot gets a clip shorter than it: that fit is never called High.
    const held = SHOT_NEEDS.findIndex((n) => /held/.test(n));
    expect(vietnam.picks[held]?.sure).not.toBe('high');
  });

  it('give back the reel from its own trip, clip for slot', () => {
    const flight = rollById('flight');
    expect(flight.label).toBe('A flight out');
    expect(flight.own).toBe(true);
    expect(flight.picks.map((p) => p.clipId)).toEqual(
      slots.map((_, i) => `airport-${String(i + 1).padStart(2, '0')}`),
    );
    expect(flight.picks.every((p) => p.sure === 'high')).toBe(true);
  });

  it('fill it from the third trip’s raw clips too, saying how sure where a clip fits less well', () => {
    const repeat = rollById('repeat');
    expect(ROLLS.map((r) => r.id)).toEqual(['vietnam', 'flight', 'repeat', 'next']);
    expect(repeat.label).toBe('Vietnam, on repeat');
    expect(repeat.picks.every((p) => p.clipId.startsWith('repeat-'))).toBe(true);
    expect(fillWords(repeat, 9)).toBe('Vietnam, on repeat: 9 slots filled, 2 picks less sure.');
  });

  it('end with the empty roll, the template waiting', () => {
    const next = rollById('next');
    expect(ROLLS.at(-1)?.id).toBe('next');
    expect(next.picks).toEqual([]);
    expect(next.cover).toBeUndefined();
    expect(fillWords(next, 9)).toBe('Your next trip: the template waits for its clips.');
  });

  it('say the fill in one line', () => {
    expect(fillWords(rollById('vietnam'), 9)).toBe('Vietnam trip: 9 slots filled, 2 picks less sure.');
    expect(fillWords(rollById('flight'), 9)).toBe('A flight out: its own 9 clips, so it plays as the reel.');
  });
});

describe('your version’s clock', () => {
  it('finds the slot playing at a time, the last one at the end', () => {
    expect(slotIndexAt(slots, 0)).toBe(0);
    expect(slotIndexAt(slots, (slots[3]?.start ?? 0) + 0.01)).toBe(3);
    expect(slotIndexAt(slots, reel.durationSec + 1)).toBe(slots.length - 1);
  });

  it('plays a clip as shot, slows a short one to fill its slot, and never below half speed', () => {
    expect(clipRate(2, 1)).toBe(1);
    expect(clipRate(0.75, 1)).toBe(0.75);
    expect(clipRate(0.3, 1.43)).toBe(0.5);
    expect(clipRate(1, 0)).toBe(1);
  });
});

describe('the starters', () => {
  it('are the 14 the app ships, 8 in each language, in 8 formats', () => {
    expect(STARTERS).toHaveLength(14);
    expect(FORMATS).toHaveLength(8);
    expect(new Set(STARTERS.map((s) => s.format)).size).toBe(8);
    for (const language of LANGUAGES) expect(startersIn(language), language).toHaveLength(8);
    expect(startersInOneLanguage()).toBe(8);
  });

  it('carry their own slots, end to end at their length', () => {
    for (const s of STARTERS) {
      const total = s.slots.reduce((sum, l) => sum + l, 0);
      expect(total, s.id).toBeCloseTo(s.seconds, 1);
      expect(s.beats, s.id).toBeGreaterThan(s.slots.length);
    }
  });
});

describe('the page’s words', () => {
  it('hold to the truth ledger', () => {
    const words = [
      ...SHOT_NEEDS,
      ...ROLLS.map((r) => r.label),
      ...ROLLS.map((r) => fillWords(r, slots.length)),
      ...ROLLS.flatMap((r) => r.picks.map((p) => pickWords(p).name)),
      ...STARTERS.map((s) => s.name),
      ...FORMATS.map((f) => f.name),
      SHOWCASE_HINTS.templates?.title ?? '',
    ];
    expect(words.flatMap(claimViolations)).toEqual([]);
  });
});
