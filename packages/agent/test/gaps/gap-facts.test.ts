// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: what's wrong, as facts the card puts in plain words: what a shot asks for, the template's words made short
 * (no framing, a capital only where it is a name, at most 80 characters); the counts over the video; and the clip
 * that comes closest, from the unsure clip's next-best, another shot's clip or another part of a used one.
 */
import { closestOf, shortWants, summaryOf } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { borrowFrom, clip, madeUp, reuseOf, sure, unsure } from './ask-made-up';

describe("a shot's wants, made short (FIX-ASK)", () => {
  it.each([
    ['Someone checking a phone, surprised by a message', 'someone checking a phone'],
    ['A close-up of someone checking a phone. They smile.', 'someone checking a phone'],
    ['Wide shot of the beach at sunrise', 'the beach at sunrise'],
    ['Tokyo Tower at night - neon everywhere', 'Tokyo Tower at night'],
    ['Hands counting change at the stall', 'hands counting change at the stall'],
    ['  POV:   walking into the market  ', 'walking into the market'],
    ['Close-up: hands on the wheel', 'hands on the wheel'],
  ])('%s → %s', (text, wants) => {
    expect(shortWants(text)).toBe(wants);
  });

  it('cuts a long clause at a word, and says nothing for no words', () => {
    const long = shortWants(
      'A slow tracking shot of a woman walking through a crowded night market full of lanterns and food stalls and music',
    );
    expect(long!.length).toBeLessThanOrEqual(80);
    expect(long).toMatch(/^a woman walking through a crowded night market .*…$/);
    expect(shortWants('')).toBeNull();
    expect(shortWants(null)).toBeNull();
  });
});

describe('the counts over a video', () => {
  it("the owner's: 13 shots, 12 with a clip, 1 with nothing, 2 unsure", () => {
    const weak = { state: 'weak' as const, weak: unsure(0.45) };
    const timeline = madeUp([weak, ...sure(2), weak, ...sure(4), { state: 'empty' }, ...sure(4)]);
    expect(summaryOf(timeline)).toEqual({ shots: 13, filled: 12, empty: 1, unsure: 2 });
  });
});

describe('the closest clip', () => {
  it('is the best fit an empty shot could take: another shot’s clip, or another part of one', () => {
    const base = madeUp([...sure(4), { state: 'empty' }]);
    const [, , , giver, gap] = base.slots;
    const borrow = borrowFrom(giver!, 0.55, clip('A tram passing', 0.5));
    const reuse = reuseOf(base.slots[0]!, 0.62);
    expect(closestOf({ ...gap!, offers: { borrow: [borrow], reuse: [reuse] } })).toMatchObject({
      assetId: reuse.assetId,
      fit: 0.62,
      usedIn: 1,
    });
    expect(closestOf({ ...gap!, offers: { borrow: [borrow], reuse: [] } })).toMatchObject({ usedIn: 4 });
    expect(closestOf(gap!)).toBeNull();
  });

  it('for an unsure clip, only one that fits better than it counts', () => {
    const next = clip('A quiet street', 0.3);
    const weak = madeUp([{ state: 'weak', weak: unsure(0.45, [next]) }]).slots[0]!;
    expect(closestOf(weak)).toBeNull();
    const better = clip('A phone screen lights up a face', 0.7);
    const shot = madeUp([{ state: 'weak', weak: unsure(0.45, [next, better]) }]).slots[0]!;
    expect(closestOf(shot)).toMatchObject({ description: 'A phone screen lights up a face', usedIn: null });
  });
});
