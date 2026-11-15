// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** applyCast, the edit that puts a cast's picks into the timeline (the other pure edits: edits.test.ts). */
import { FrameRates, newId, RationalTime, TimeRange, type MediaRef, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { applyCast } from '../src/edits/swap';
import { candidateKey } from '../src/model/cast';
import { checkEdited } from '../src/model/validate';
import { buildTimeline, candidate, clipById } from './fixtures/timeline';

const rate = FrameRates.fps30;
const user = { source: 'ui' } as const;
const f = (value: number) => RationalTime.of(value, rate);

function video(frames: number): MediaRef {
  return {
    kind: 'video',
    assetId: newId<'Asset'>(),
    shotId: newId<'Shot'>(),
    available: TimeRange.of(f(0), f(frames)),
  };
}

function valid(timeline: Timeline): Timeline {
  const checked = checkEdited(timeline);
  if (!checked.ok) throw new Error(checked.error.detail);
  return checked.value;
}

describe('applyCast', () => {
  it('swaps every listed slot, skips locked and user-picked ones, and fills gaps', () => {
    const { timeline, ids, slots } = buildTimeline({
      clips: [{ frames: 30 }, { frames: 30, locked: true }, { frames: 30, gap: true }, { frames: 30 }],
    });
    const userPicked = {
      ...timeline,
      cast: timeline.cast && {
        ...timeline.cast,
        slots: timeline.cast.slots.map((slot, index) =>
          index === 3 ? { ...slot, note: 'userPick' as const } : slot,
        ),
      },
    };
    const medias = [video(300), video(300), video(300), video(300)];
    const pick = (index: number) => ({
      slotId: slots[index]!,
      pick: {
        ...candidate(clipById(timeline, ids[0]!)),
        assetId: medias[index]!.assetId,
        shotId: medias[index]!.kind === 'video' ? medias[index]!.shotId : null,
        sourceStart: f(20),
        syncPoint: f(20),
        score: 0.9,
      },
    });
    const media = new Map(
      medias.map((ref) => [
        candidateKey({ assetId: ref.assetId, shotId: ref.kind === 'video' ? ref.shotId : null }),
        ref,
      ]),
    );
    const applied = applyCast(userPicked, [pick(0), pick(1), pick(2), pick(3)], {
      ...user,
      media,
      tau: 0.05,
    });
    if (!applied.ok) throw new Error(applied.error.code);
    const result = valid(applied.value.timeline);
    expect(clipById(result, ids[0]!).media).toEqual(medias[0]);
    expect(clipById(result, ids[1]!).media).toEqual(clipById(timeline, ids[1]!).media);
    expect(clipById(result, ids[2]!).media).toEqual(medias[2]);
    expect(clipById(result, ids[3]!).media).toEqual(clipById(timeline, ids[3]!).media);
    const filled = result.cast?.slots[2];
    expect(filled?.clipId).toBe(ids[2]);
    expect(filled?.confidence).toBe(1);
    const missing = applyCast(timeline, [pick(0)], { ...user, media: new Map(), tau: 0.05 });
    expect(!missing.ok && missing.error.code).toBe('timeline.media_missing');
  });

  it('caps a pick’s confidence at its fit, as casting does, so a poor fit stays a weak pick', () => {
    const { timeline, ids, slots } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30, gap: true }] });
    const media = video(300);
    const base = {
      ...candidate(clipById(timeline, ids[0]!)),
      assetId: media.assetId,
      shotId: media.kind === 'video' ? media.shotId : null,
    };
    const poor = {
      ...base,
      sourceStart: f(20),
      syncPoint: f(20),
      score: 0.9,
      parts: { ...base.parts, intent: 0.2 },
    };
    const medias = new Map([[candidateKey(poor), media]]);
    const fitCap = (pick: { readonly parts: { readonly intent: number } }) =>
      pick.parts.intent < 0.5 ? 0.1 : 1;
    const applied = applyCast(timeline, [{ slotId: slots[1]!, pick: poor }], {
      ...user,
      media: medias,
      tau: 0.05,
      fitCap,
    });
    if (!applied.ok) throw new Error(applied.error.code);
    expect(applied.value.timeline.cast?.slots[1]?.confidence).toBe(0.1);
    // Without a cap (the call before FIX-CAST's rule reached it), the same lone pick reads as certain.
    const uncapped = applyCast(timeline, [{ slotId: slots[1]!, pick: poor }], {
      ...user,
      media: medias,
      tau: 0.05,
    });
    if (!uncapped.ok) throw new Error(uncapped.error.code);
    expect(uncapped.value.timeline.cast?.slots[1]?.confidence).toBe(1);
  });
});
