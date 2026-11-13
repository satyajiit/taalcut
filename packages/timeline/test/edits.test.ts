// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The pure edits: swap, trim (roll, slip, ripple), move, editText, lockClip and applyCast. */
import { FrameRates, newId, RationalTime, TimeRange, type MediaRef, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { moveClip } from '../src/edits/move';
import { applyCast, swapClip, type Replacement } from '../src/edits/swap';
import { editText, lockClip, moveText } from '../src/edits/text';
import { trimClip } from '../src/edits/trim';
import { candidateKey } from '../src/model/cast';
import { checkEdited } from '../src/model/validate';
import { buildTimeline, candidate, clipById, starts } from './fixtures/timeline';

const rate = FrameRates.fps30;
const user = { source: 'ui' } as const;
const agent = { source: 'agent' } as const;
const f = (value: number) => RationalTime.of(value, rate);

function video(frames: number): MediaRef {
  return {
    kind: 'video',
    assetId: newId<'Asset'>(),
    shotId: newId<'Shot'>(),
    available: TimeRange.of(f(0), f(frames)),
  };
}

function replacement(media: MediaRef, sourceStart = 10): Replacement {
  return { media, sourceStart: f(sourceStart), syncPoint: f(sourceStart), candidate: null };
}

function valid(timeline: Timeline): Timeline {
  const checked = checkEdited(timeline);
  if (!checked.ok) throw new Error(checked.error.detail);
  return checked.value;
}

describe('swapClip', () => {
  it('puts new media in the same place for the same length and keeps the id', () => {
    const { timeline, ids, slots } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }] });
    const old = clipById(timeline, ids[1]!);
    const media = video(200);
    const swapped = swapClip(timeline, { clipId: ids[1]!, from: 'search' }, replacement(media), user);
    if (!swapped.ok) throw new Error(swapped.error.code);
    const clip = clipById(valid(swapped.value.timeline), ids[1]!);
    expect(clip.media).toEqual(media);
    expect(clip.duration).toEqual(old.duration);
    expect(starts(swapped.value.timeline)).toEqual(starts(timeline));
    const slot = swapped.value.timeline.cast?.slots.find((entry) => entry.slotId === slots[1]);
    expect(slot?.pick?.assetId).toBe(media.assetId);
    expect(slot?.alternates[0]).toEqual(candidate(old));
    expect(slot?.note).toBe('userPick');
    expect(swapped.value.changed).toEqual(['tracks', 'markers', 'cast']);
  });

  it('refuses media shorter than the clip, and agents on a locked clip', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30, locked: true }] });
    const short = swapClip(timeline, { clipId: ids[0]!, from: 'search' }, replacement(video(20), 0), user);
    expect(!short.ok && short.error.code).toBe('timeline.media_too_short');
    const locked = swapClip(timeline, { clipId: ids[1]!, from: 'agent' }, replacement(video(200)), agent);
    expect(!locked.ok && locked.error.code).toBe('timeline.clip_locked');
    expect(swapClip(timeline, { clipId: ids[1]!, from: 'search' }, replacement(video(200)), user).ok).toBe(
      true,
    );
    const missing = swapClip(
      timeline,
      { clipId: newId<'TimelineItem'>(), from: 'search' },
      replacement(video(200)),
      user,
    );
    expect(!missing.ok && missing.error.code).toBe('timeline.item_not_found');
  });

  it('takes a still for any length', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }] });
    const image: MediaRef = { kind: 'image', assetId: newId<'Asset'>() };
    const swapped = swapClip(timeline, { clipId: ids[0]!, from: 'search' }, replacement(image), user);
    if (!swapped.ok) throw new Error(swapped.error.code);
    expect(clipById(valid(swapped.value.timeline), ids[0]!).syncPoint).toBeNull();
  });
});

describe('trimClip', () => {
  it('slips the first edge: the in-point moves, the length stays', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }] });
    const slipped = trimClip(timeline, { clipId: ids[0]!, edge: 'start', by: f(5) }, user);
    if (!slipped.ok) throw new Error(slipped.error.code);
    const clip = clipById(valid(slipped.value.timeline), ids[0]!);
    expect(clip.sourceStart).toEqual(f(95));
    expect(clip.syncPoint).toBeNull();
    expect(starts(slipped.value.timeline)).toEqual(starts(timeline));
  });

  it('rolls between two clips: the neighbour gives the frames', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    const rolled = trimClip(timeline, { clipId: ids[1]!, edge: 'start', by: f(15) }, user);
    if (!rolled.ok) throw new Error(rolled.error.code);
    expect(starts(valid(rolled.value.timeline))).toEqual([0, 15, 60, 90]);
  });

  it('ripples the last edge and refuses to run past the media or below a frame', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30, media: 140 }] });
    const shorter = trimClip(timeline, { clipId: ids[1]!, edge: 'end', by: f(-15) }, user);
    if (!shorter.ok) throw new Error(shorter.error.code);
    expect(starts(valid(shorter.value.timeline))).toEqual([0, 30, 45]);
    const past = trimClip(timeline, { clipId: ids[1]!, edge: 'end', by: f(15) }, user);
    expect(!past.ok && past.error.code).toBe('timeline.media_too_short');
    const gone = trimClip(timeline, { clipId: ids[1]!, edge: 'end', by: f(-30) }, user);
    expect(!gone.ok && gone.error.code).toBe('timeline.invalid_move');
    expect(trimClip(timeline, { clipId: ids[1]!, edge: 'end', by: f(0) }, user)).toEqual({
      ok: true,
      value: { timeline, changed: [] },
    });
  });

  it('refuses a roll that would use up the neighbour, and says how far the edge can go', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 45 }, { frames: 30 }] });
    const longer = trimClip(timeline, { clipId: ids[0]!, edge: 'end', by: f(60) }, user);
    expect(!longer.ok && longer.error.code).toBe('timeline.invalid_move');
    expect(!longer.ok && longer.error.detail).toMatch(/the clip next to it, which lasts 1.5 s: move the edge by less/);
    const shorter = trimClip(timeline, { clipId: ids[0]!, edge: 'end', by: f(-30) }, user);
    expect(!shorter.ok && shorter.error.detail).toMatch(/The clip lasts 1 s: shorten it by less than that/);
  });

  it('refuses an agent trim that would change a locked neighbour', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30, locked: true }, { frames: 30 }] });
    const refused = trimClip(timeline, { clipId: ids[1]!, edge: 'start', by: f(15) }, agent);
    expect(!refused.ok && refused.error.code).toBe('timeline.clip_locked');
  });

  it('rescales a trim given at another rate', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    const halfSecond = RationalTime.of(24_000, FrameRates.hz48000);
    const rolled = trimClip(timeline, { clipId: ids[1]!, edge: 'end', by: halfSecond }, user);
    expect(rolled.ok && starts(rolled.value.timeline)).toEqual([0, 30, 75, 90]);
  });
});

describe('moveClip', () => {
  it('reorders content while the positions keep their lengths, anchors and slots', () => {
    const { timeline, ids, slots } = buildTimeline({
      clips: [{ frames: 30 }, { frames: 45 }, { frames: 15 }],
    });
    const moved = moveClip(timeline, { clipId: ids[0]!, toIndex: 2 }, user);
    if (!moved.ok) throw new Error(moved.error.code);
    const result = valid(moved.value.timeline);
    expect(starts(result)).toEqual(starts(timeline));
    const video = result.tracks[0];
    const order = video?.kind === 'video' ? video.items.map((item) => item.id) : [];
    expect(order).toEqual([ids[1], ids[2], ids[0]]);
    const a = clipById(result, ids[0]!);
    expect(a.duration).toEqual(f(15));
    expect(a.slotId).toBe(slots[2]);
    expect(a.beatAnchor).toEqual(clipById(timeline, ids[2]!).beatAnchor);
    const first = result.cast?.slots[0];
    expect(first?.clipId).toBe(ids[1]);
    expect(first?.pick && candidateKey(first.pick)).toBe(
      candidateKey(candidate(clipById(timeline, ids[1]!))),
    );
    expect(moveClip(timeline, { clipId: ids[0]!, toIndex: 0 }, user)).toEqual({
      ok: true,
      value: { timeline, changed: [] },
    });
    const nowhere = moveClip(timeline, { clipId: ids[0]!, toIndex: 7 }, user);
    expect(!nowhere.ok && nowhere.error.code).toBe('timeline.invalid_move');
  });

  it('refuses a move the media can not fill, and agents moving locked clips', () => {
    const { timeline, ids } = buildTimeline({
      clips: [{ frames: 30, media: 40, sourceStart: 0 }, { frames: 90 }, { frames: 30, locked: true }],
    });
    const short = moveClip(timeline, { clipId: ids[0]!, toIndex: 1 }, user);
    expect(!short.ok && short.error.code).toBe('timeline.media_too_short');
    const locked = moveClip(timeline, { clipId: ids[1]!, toIndex: 2 }, agent);
    expect(!locked.ok && locked.error.code).toBe('timeline.clip_locked');
  });

  it('places the sync point of a clip moving into a ramp with the ramp integral, not the speed at frame 0', () => {
    const built = buildTimeline({
      clips: [
        {
          frames: 90,
          ramp: [
            [0, 0.5],
            [60, 2],
          ],
        },
        { frames: 90, sourceStart: 170, sync: 200 },
      ],
    });
    // The first position's anchor lands 30 frames into it (beat 2 of a 15-frame grid).
    const first = clipById(built.timeline, built.ids[0]!);
    const video = built.timeline.tracks[0];
    if (video?.kind !== 'video') throw new Error('no video');
    const anchored = { ...first, beatAnchor: { beatIndex: 2, offset: f(0) } };
    const timeline = {
      ...built.timeline,
      tracks: [{ ...video, items: [anchored, ...video.items.slice(1)] }],
    };
    const moved = moveClip(valid(timeline), { clipId: built.ids[1]!, toIndex: 0 }, user);
    if (!moved.ok) throw new Error(moved.error.code);
    // Linear 0.5× → 2× over 60 frames plays 60 · (0.5 · 0.5 + 1.5 · 0.5² / 2) = 26.25 source frames in the
    // first 30, so the in-point is 26 frames before the peak (speedAt(0) would give 15).
    expect(clipById(valid(moved.value.timeline), built.ids[1]!).sourceStart).toEqual(f(174));
  });

  it('moves a clip into a gap position', () => {
    const { timeline, ids } = buildTimeline({
      clips: [{ frames: 30 }, { frames: 30, gap: true }, { frames: 30 }],
    });
    const moved = moveClip(timeline, { clipId: ids[2]!, toIndex: 1 }, user);
    if (!moved.ok) throw new Error(moved.error.code);
    const video = valid(moved.value.timeline).tracks[0];
    expect(video?.kind === 'video' && video.items.map((item) => item.type)).toEqual(['clip', 'clip', 'gap']);
  });
});

describe('editText and lockClip', () => {
  it('replaces the text and records who wrote it', () => {
    const { timeline } = buildTimeline({ clips: [{ frames: 30 }], texts: [{ start: 0, frames: 10 }] });
    const track = timeline.tracks[1];
    const itemId = track?.kind === 'text' ? track.items[0]!.id : newId<'TimelineItem'>();
    const byUser = editText(timeline, { itemId, text: 'Goa, day one' }, user);
    const byAgent = editText(timeline, { itemId, text: 'Goa' }, agent);
    const item = (result: typeof byUser) => {
      const text = result.ok ? result.value.timeline.tracks[1] : undefined;
      return text?.kind === 'text' ? text.items[0] : undefined;
    };
    expect(item(byUser)).toMatchObject({ text: 'Goa, day one', origin: 'user' });
    expect(item(byAgent)).toMatchObject({ text: 'Goa', origin: 'editor' });
    const missing = editText(timeline, { itemId: newId<'TimelineItem'>(), text: 'x' }, user);
    expect(!missing.ok && missing.error.code).toBe('timeline.item_not_found');
    // AGT1: the refusal names the ids there are (MLX1's 9B guessed seven in a row), never their words.
    expect(!missing.ok && missing.error.detail).toContain(`Its text items: ${itemId} (text at 0.0 s)`);
    expect(!missing.ok && missing.error.detail).not.toContain('Goa');
  });

  it('edits and moves text items only: a motion graphic (Timeline v2) is not text', () => {
    const { timeline } = buildTimeline({ clips: [{ frames: 30 }], texts: [{ start: 0, frames: 10 }] });
    const track = timeline.tracks[1];
    if (track?.kind !== 'text') throw new Error('a text track');
    const graphicId = newId<'TimelineItem'>();
    const graphic = {
      type: 'graphic' as const,
      id: graphicId,
      anchor: { kind: 'time' as const, at: f(15) },
      start: f(15),
      duration: f(10),
      placement: 'bottom' as const,
      styleKey: 'label',
      language: null,
      origin: 'agent' as const,
      composition: { id: newId<'GraphicComposition'>(), hash: 'c'.repeat(64), params: { title: 'Priya' } },
    };
    const tracks = timeline.tracks.map((t) =>
      t.kind === 'text' ? { ...t, items: [...t.items, graphic] } : t,
    );
    const withGraphic = valid({ ...timeline, tracks });
    const edited = editText(withGraphic, { itemId: graphicId, text: 'x' }, user);
    expect(!edited.ok && edited.error.code).toBe('timeline.item_not_found');
    const box = { x: 0.1, y: 0.2, width: 0.5, height: 0.1 };
    const moved = moveText(withGraphic, { itemId: graphicId, box }, user);
    expect(!moved.ok && moved.error.code).toBe('timeline.item_not_found');
    const text = moveText(withGraphic, { itemId: track.items[0]!.id, box }, user);
    expect(text.ok && valid(text.value.timeline).tracks[1]).toMatchObject({
      items: [{ box }, { type: 'graphic' }],
    });
  });

  it('batches text edits, retiming, box moves and removals in one step', () => {
    const { timeline } = buildTimeline({
      clips: [{ frames: 60 }],
      texts: [{ start: 0, frames: 10 }, { start: 15, frames: 10 }, { start: 30, frames: 5 }],
    });
    const track = timeline.tracks[1];
    if (track?.kind !== 'text') throw new Error('a text track');
    const [first, second, third] = track.items.map((item) => item.id);
    const box = { x: 0.12, y: 0.18, width: 0.76, height: 0.08 };
    const movedAll = moveText(timeline, { itemIds: [first!, second!, third!], box }, agent);
    if (!movedAll.ok) throw new Error(movedAll.error.code);
    const edits = [
      { itemId: first!, text: 'Full reel title', start: f(0), duration: f(60) },
      { itemId: second!, remove: true },
      { itemId: third!, remove: true },
    ];
    const batchEdited = editText(movedAll.value.timeline, { edits }, agent);
    if (!batchEdited.ok) throw new Error(batchEdited.error.code);
    const remaining = valid(batchEdited.value.timeline).tracks.flatMap((t) => (t.kind === 'text' ? t.items : []));
    expect(remaining).toEqual([expect.objectContaining({ id: first, text: 'Full reel title', start: f(0), duration: f(60), box })]);
  });

  it('explicit lock and unlock commands have UI and AI parity', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30, locked: true }, { frames: 30 }] });
    const agentUnlock = lockClip(timeline, { clipId: ids[0]!, locked: false }, agent);
    expect(agentUnlock).toEqual(lockClip(timeline, { clipId: ids[0]!, locked: false }, user));
    const unlocked = lockClip(timeline, { clipId: ids[0]!, locked: false }, user);
    expect(unlocked.ok && clipById(unlocked.value.timeline, ids[0]!).locked).toBe(false);
    const locked = lockClip(timeline, { clipId: ids[1]!, locked: true }, agent);
    expect(locked.ok && clipById(locked.value.timeline, ids[1]!).locked).toBe(true);
    expect(lockClip(timeline, { clipId: ids[0]!, locked: true }, user)).toEqual({
      ok: true,
      value: { timeline, changed: [] },
    });
  });
});

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
