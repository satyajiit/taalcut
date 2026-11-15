// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AssetDetail, CastCandidate } from '@taalcut/core';
import { shotKey } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { buildModel, type ClipView } from '../src/features/timeline/model';
import {
  certainlyTooShort,
  footageMs,
  inShownOrder,
  MAX_OTHER_SHOTS,
  optionsFor,
  shotOptions,
} from '../src/features/timeline/other-shots/shot-options';
import { castFixture, SCORES, swapped } from './other-shots-support';

const at = (value: number, num = 30) => ({ value, rate: { num, den: 1 } });

/** As much of a file as the options read: its length and one shot's range. */
function detailOf(candidate: CastCandidate, seconds: number, shot?: { start: number; length: number }) {
  return {
    asset: { duration: at(seconds * 30) },
    shots: shot
      ? [{ id: candidate.shotId, range: { start: at(shot.start), duration: at(shot.length) } }]
      : [],
  } as unknown as AssetDetail;
}

describe('the other shots a clip offers', () => {
  it('lists what plays now, then the others best first', () => {
    const { model } = castFixture();
    const clip = model.clips[1]!;
    const options = shotOptions(clip)!;
    expect(options[0]).toMatchObject({ current: true, key: shotKey(clip.cast!.pick!) });
    expect(options.slice(1).map((option) => option.candidate.score)).toEqual(
      [...SCORES].sort((a, b) => b - a),
    );
    expect(options.slice(1).every((option) => !option.current)).toBe(true);
  });

  it('has nothing for a clip without a cast, or whose cast kept nothing else', () => {
    const { timeline, model } = castFixture();
    expect(shotOptions({ ...model.clips[0]!, cast: null })).toBeNull();
    const bare = buildModel({ ...timeline, cast: null }, null);
    expect(bare.clips.every((clip) => shotOptions(clip) === null)).toBe(true);
    const alone: ClipView = { ...model.clips[0]!, cast: { ...model.clips[0]!.cast!, alternates: [] } };
    expect(shotOptions(alone)).toBeNull();
    expect(optionsFor(model, 'not-a-clip' as ClipView['item']['id'])).toBeNull();
  });

  it('never lists what plays twice, and shows four others at most', () => {
    const { model } = castFixture();
    const clip = model.clips[0]!;
    const cast = clip.cast!;
    const extra = model.clips
      .slice(1, 4)
      .flatMap((other) => other.cast!.alternates)
      .filter(
        (candidate) => ![cast.pick!, ...cast.alternates].some((own) => shotKey(own) === shotKey(candidate)),
      );
    const crowded: ClipView = {
      ...clip,
      cast: { ...cast, alternates: [cast.pick!, ...cast.alternates, ...extra] },
    };
    const options = shotOptions(crowded)!;
    expect(options.filter((option) => option.key === shotKey(cast.pick!))).toHaveLength(1);
    expect(options).toHaveLength(1 + MAX_OTHER_SHOTS);
  });

  it('follows a swap: the new shot plays, the old pick is one of the others', () => {
    const { timeline, model } = castFixture();
    const clip = model.clips[2]!;
    const before = shotOptions(clip)!;
    const chosen = before[2]!;
    const after = optionsFor(
      buildModel(swapped(timeline, clip.item.id, chosen.candidate), null),
      clip.item.id,
    )!;
    expect(after[0]).toMatchObject({ current: true, key: chosen.key });
    expect(after.map((option) => option.key).sort()).toEqual(before.map((option) => option.key).sort());
    // The panel keeps the frames where they were: only the mark moved.
    const kept = inShownOrder(
      after,
      before.map((option) => option.key),
    );
    expect(kept.map((option) => option.key)).toEqual(before.map((option) => option.key));
    expect(kept.map((option) => option.current)).toEqual([false, false, true, false]);
  });

  it('reads what plays from the clip when the cast names another shot', () => {
    const { model } = castFixture();
    const clip = model.clips[0]!;
    const other = model.clips[5]!.cast!.pick!;
    const moved: ClipView = { ...clip, cast: { ...clip.cast!, pick: other } };
    const options = shotOptions(moved)!;
    expect(options[0]).toMatchObject({ current: true, key: shotKey(clip.cast!.pick!) });
    expect(options[0]!.candidate.sourceStart).toEqual(clip.item.sourceStart);
    expect(options.some((option) => option.key === shotKey(other) && !option.current)).toBe(true);
  });
});

describe('how much footage a shot has', () => {
  const candidate = { ...castFixture().model.clips[0]!.cast!.alternates[0]!, sourceStart: at(60) };

  it('counts from where it would start to the end of its shot', () => {
    expect(footageMs(candidate, detailOf(candidate, 20, { start: 30, length: 150 }))).toBe(4000);
    expect(footageMs(candidate, detailOf(candidate, 20))).toBe(18000);
    expect(footageMs(candidate, undefined)).toBeNull();
    expect(footageMs({ ...candidate, shotId: null }, detailOf(candidate, 20))).toBeNull();
  });

  it('says too short only when the file itself ends before the clip would', () => {
    const { model } = castFixture();
    const clip = { ...model.clips[0]!, start: 0, end: 90 };
    expect(certainlyTooShort(clip, model.rate, candidate, detailOf(candidate, 4))).toBe(true);
    expect(certainlyTooShort(clip, model.rate, candidate, detailOf(candidate, 5))).toBe(false);
    // Unknown, a photo, or a ramp the timeline could make gentler: the command decides.
    expect(certainlyTooShort(clip, model.rate, candidate, undefined)).toBe(false);
    expect(certainlyTooShort(clip, model.rate, { ...candidate, shotId: null }, detailOf(candidate, 1))).toBe(
      false,
    );
    const ramped = { ...clip, item: { ...clip.item, speed: {} as NonNullable<ClipView['item']['speed']> } };
    expect(certainlyTooShort(ramped, model.rate, candidate, detailOf(candidate, 1))).toBe(false);
  });
});
