// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { CAMERA_ROLL } from '#content/reels';
import { EYES, QR_SIZE, inEye, qrModules, samplePin } from '#components/showcase/auto-pick/qr-pattern';
import { byDay, clipLength, dayWords, matchClips, SAMPLE_ROLL, SEARCH_SUGGESTIONS, searchWords } from '#components/showcase/auto-pick/roll';
import { filmstripCount, frameAtTime, frameOf, framesOf, spriteStyle } from '#components/showcase/frames';

describe('the sample roll', () => {
  it('is the owner’s camera roll, every clip with its words and its frame in the atlas', () => {
    expect(SAMPLE_ROLL.map((c) => c.id)).toEqual(CAMERA_ROLL.clips.map((c) => c.id));
    for (const clip of SAMPLE_ROLL) {
      expect(clip.name.length, clip.id).toBeGreaterThan(3);
      expect(clip.short.length, clip.id).toBeLessThanOrEqual(16);
      expect(clip.sprite, clip.id).toBe(CAMERA_ROLL.clips.find((c) => c.id === clip.id)?.sprite);
    }
    expect(new Set(SAMPLE_ROLL.map((c) => c.id)).size).toBe(SAMPLE_ROLL.length);
  });
});

describe('searching the sample roll in plain words', () => {
  it('finds every suggested word, and not every clip', () => {
    for (const word of SEARCH_SUGGESTIONS) {
      const found = matchClips(SAMPLE_ROLL, word);
      expect(found.length, word).toBeGreaterThan(2);
      expect(found.length, word).toBeLessThan(SAMPLE_ROLL.length);
    }
  });

  it('drops the small words and plurals people type', () => {
    expect(searchWords('the night shots')).toEqual(['night']);
    expect(searchWords('Lanterns on the street')).toEqual(['lantern', 'street']);
    expect(matchClips(SAMPLE_ROLL, 'the night shots')).toEqual(matchClips(SAMPLE_ROLL, 'night'));
  });

  it('needs every word to match, by a word’s start', () => {
    const both = matchClips(SAMPLE_ROLL, 'lanterns on the street');
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((c) => c.tags.includes('lanterns') && c.tags.includes('street'))).toBe(true);
    expect(matchClips(SAMPLE_ROLL, 'lant').length).toBeGreaterThan(0);
    expect(matchClips(SAMPLE_ROLL, 'zebra')).toEqual([]);
    expect(matchClips(SAMPLE_ROLL, '   ')).toHaveLength(SAMPLE_ROLL.length);
  });

  it('groups by day in order and says the day and the length in words', () => {
    const days = byDay(SAMPLE_ROLL);
    expect(days.map((d) => d.day)).toEqual([...days.map((d) => d.day)].sort());
    expect(days.flatMap((d) => d.clips)).toHaveLength(SAMPLE_ROLL.length);
    expect(dayWords('2026-10-04')).toBe('Sunday, Oct 4');
    expect(clipLength(6.53)).toBe('6.5 s');
    expect(clipLength(0.3)).toBe('0.3 s');
    expect(clipLength(8)).toBe('8 s');
  });
});

describe('the frames', () => {
  it('finds every roll clip’s frames in the atlas, in time order, and none for a clip with no footage', () => {
    for (const clip of SAMPLE_ROLL) {
      const frames = framesOf(clip.id);
      expect(frames.length, clip.id).toBeGreaterThan(0);
      expect(frames, clip.id).toContain(clip.sprite);
      expect(frameOf(clip.id)).toBe(clip.sprite);
    }
    expect(framesOf(undefined)).toEqual([]);
    expect(framesOf('goa-01')).toEqual([]);
    expect(frameOf(undefined)).toBeUndefined();
    expect(frameAtTime(undefined, 1)).toBeUndefined();
  });

  it('steps through a clip’s frames as time passes, and round again', () => {
    const frames = framesOf('vietnam-01');
    expect(frameAtTime('vietnam-01', 0)).toBe(frames[0]);
    expect(frameAtTime('vietnam-01', 0.21)).toBe(frames[1]);
    expect(frameAtTime('vietnam-01', 0.2 * frames.length + 0.01)).toBe(frames[0]);
  });

  it('cuts one cell out of the atlas at the box’s own size', () => {
    const { columns, rows, src } = CAMERA_ROLL.atlas;
    const first = spriteStyle(0);
    expect(first.backgroundImage).toBe(`url(${src})`);
    expect(first.backgroundSize).toBe(`${columns * 100}% ${rows * 100}%`);
    expect(first.backgroundPosition).toBe('0% 0%');
    expect(spriteStyle(columns * rows - 1).backgroundPosition).toBe('100% 100%');
    expect(filmstripCount(0.5, 30)).toBe(16);
    expect(filmstripCount(0, 30)).toBe(1);
  });
});

describe('the sample pairing code', () => {
  it('draws the same pattern and PIN from the same seed, and another from the next', () => {
    expect(qrModules(7)).toEqual(qrModules(7));
    expect(qrModules(7)).not.toEqual(qrModules(8));
    expect(samplePin(7)).toMatch(/^\d{6}$/);
    expect(samplePin(7)).toBe(samplePin(7));
  });

  it('keeps the three eyes clear of modules', () => {
    expect(EYES).toHaveLength(3);
    for (const [x, y] of qrModules(20261105)) {
      expect(inEye(x, y)).toBe(false);
      expect(x).toBeLessThan(QR_SIZE);
      expect(y).toBeLessThan(QR_SIZE);
    }
  });
});
