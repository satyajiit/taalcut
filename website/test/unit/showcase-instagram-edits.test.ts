// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { CAMERA_ROLL } from '#content/reels';
import { HINT, LOOK } from '#components/showcase/instagram-edits/meta';
import {
  beatsOf,
  cutOf,
  FEED_TABS,
  FIRST_SAVED,
  hookLabel,
  hooksOf,
  LEVEL_WORDS,
  LICENCES,
  SCORED,
  SHOWN_TABS,
  SOUNDS,
  soundsIn,
  waveOf,
} from '#components/showcase/instagram-edits/sounds';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const saved = new Set(FIRST_SAVED);
const ids = (list: readonly { id: string }[]) => list.map((s) => s.id);

describe('the Trending sounds & hooks shelf', () => {
  it('has the app’s tabs and licence filter, in its words and order', () => {
    expect([...FEED_TABS]).toEqual(['Trending', 'For You', 'Original audio', 'Royalty-free', 'Saved']);
    expect(LICENCES.map((l) => l.label)).toEqual(['All audio', 'Royalty-free', 'Licensed']);
  });

  it('puts the tabs its story needs on show, in the app’s order, Saved last', () => {
    expect([...SHOWN_TABS]).toEqual(['Trending', 'For You', 'Saved']);
    const order = SHOWN_TABS.map((t) => FEED_TABS.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('gives every sound the reel it would cut: a different clip of the owner’s roll each', () => {
    const roll = new Set(CAMERA_ROLL.clips.map((c) => c.id));
    for (const sound of SOUNDS) expect(roll.has(sound.clipId), sound.id).toBe(true);
    expect(new Set(SOUNDS.map((s) => s.clipId)).size).toBe(SOUNDS.length);
  });

  it('switches real lists: every tab has its own sounds, and Saved is what you saved', () => {
    const lists = FEED_TABS.filter((t) => t !== 'Saved').map((t) => ids(soundsIn(t, 'any', '', saved)));
    for (const list of lists) expect(list.length).toBeGreaterThan(0);
    expect(new Set(lists.map((l) => l.join())).size).toBe(lists.length);
    expect(ids(soundsIn('Saved', 'any', '', saved))).toEqual([...FIRST_SAVED]);
    expect(soundsIn('Saved', 'any', '', new Set())).toEqual([]);
  });

  it('filters by licence, and leaves someone’s original audio to All audio', () => {
    const all = soundsIn('Trending', 'any', '', saved);
    const free = soundsIn('Trending', 'royalty_free', '', saved);
    const licensed = soundsIn('Trending', 'licensed', '', saved);
    expect(free.every((s) => s.licence === 'royalty_free')).toBe(true);
    expect(licensed.every((s) => s.licence === 'licensed')).toBe(true);
    expect(free.length + licensed.length).toBeLessThan(all.length);
    expect(all.some((s) => s.licence === 'original')).toBe(true);
  });

  it('searches titles and artists, whatever the case', () => {
    expect(ids(soundsIn('Trending', 'any', 'LANTERN', saved))).toEqual(['lantern']);
    expect(ids(soundsIn('Original audio', 'any', '@yourname', saved))).toEqual(['voiceover']);
    expect(soundsIn('Trending', 'any', 'zebra', saved)).toEqual([]);
  });

  it('marks each hook drop on one of the sound’s beats, in seconds to one place', () => {
    for (const sound of SOUNDS) {
      const beats = beatsOf(sound);
      expect(beats.length, sound.id).toBeGreaterThan(12);
      expect(beats.every((b, i) => i === 0 || b > (beats[i - 1] ?? 0))).toBe(true);
      expect(beats.at(-1)).toBeLessThan(sound.durationSec);
      const hooks = hooksOf(sound);
      expect(hooks.length, sound.id).toBe(sound.hookBeats.length);
      for (const h of hooks) expect(beats).toContain(h);
    }
    expect(hookLabel(3.542)).toBe('3.5s');
    expect(hookLabel(12)).toBe('12.0s');
  });

  it('draws a waveform that is loud on the hook', () => {
    for (const sound of SOUNDS) {
      const bars = waveOf(sound, 72);
      expect(bars).toHaveLength(72);
      expect(bars.every((b) => b.level >= 0.12 && b.level <= 1)).toBe(true);
      expect(bars.some((b) => b.hook)).toBe(true);
    }
  });

  it('lays Cut with AI’s template on the beats: the hook up to the first drop, then build, peak and outro', () => {
    for (const sound of SOUNDS) {
      const beats = beatsOf(sound);
      const slots = cutOf(sound);
      expect(slots[0]).toMatchObject({ start: 0, group: 'hook', end: hooksOf(sound)[0] });
      expect(slots.at(-1)?.group).toBe('outro');
      expect(slots.map((s) => s.group)).toContain('peak');
      slots.forEach((s, i) => {
        expect(s.end).toBeGreaterThan(s.start);
        if (i > 0) expect(s.start).toBe(slots[i - 1]?.end);
        expect(beats).toContain(s.end);
      });
      expect(slots.at(-1)?.end).toBeLessThanOrEqual(sound.durationSec);
    }
  });

  it('scores clips from the owner’s camera roll as a level, never a number', () => {
    const roll = new Set(CAMERA_ROLL.clips.map((c) => c.id));
    for (const clip of SCORED) expect(roll.has(clip.clipId), clip.clipId).toBe(true);
    expect(Object.values(LEVEL_WORDS)).toEqual(['Low', 'Medium', 'High']);
  });

  it('poses as no artist: every sound is someone’s original audio or the visitor’s own', () => {
    for (const sound of SOUNDS) expect(['Original audio', '@yourname']).toContain(sound.artist);
  });

  it('holds its words to the truth ledger', () => {
    const copy = strings([SOUNDS.map((s) => [s.title, s.artist]), LICENCES, [...FEED_TABS], LEVEL_WORDS, SCORED, HINT.title, HINT.hint]);
    expect(copy.length).toBeGreaterThan(20);
    expect(copy.flatMap(claimViolations)).toEqual([]);
    expect(LOOK.area).toBe('make');
  });
});
