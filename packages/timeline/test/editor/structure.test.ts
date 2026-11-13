// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1-OPS: split, delete, insert and duplicate on core's bus: the beats held, undo and redo in one step each. */
import { EDITOR_COMMANDS, type Clip, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { clipById, starts } from '../fixtures/timeline';
import { agentOrigin, editorWorld, f, shape } from './editor-world';

const three = { clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }], texts: [{ start: 60, frames: 20 }] };
const text = (timeline: Timeline) => {
  const track = timeline.tracks.find((t) => t.kind === 'text');
  const item = track?.kind === 'text' ? track.items[0] : undefined;
  return item ? [item.start.value, item.duration.value] : null;
};
const onGrid = (timeline: Timeline) => starts(timeline).every((frame) => frame % 15 === 0);

describe('timeline.splitClip', () => {
  it('makes two clips at the time asked, the second new and slotless, and undoes in one step', async () => {
    const world = await editorWorld(three);
    const [, second] = world.built.ids;
    const split = await world.run(EDITOR_COMMANDS.splitClip, { clipId: second, at: f(40) });
    expect(split.ok).toBe(true);
    const made = split.ok ? (split.value as { itemId: string }).itemId : '';
    expect(shape(world.doc())).toEqual([['clip', 30], ['clip', 10], ['clip', 20], ['clip', 30]]);
    const half = clipById(world.doc(), made);
    expect([half.sourceStart.value, half.slotId, half.media.assetId]).toEqual([
      110,
      null,
      clipById(world.doc(), second as string).media.assetId,
    ]);
    expect(clipById(world.doc(), second as string).syncPoint?.value).toBe(100);
    await world.undo();
    expect(shape(world.doc())).toEqual([['clip', 30], ['clip', 30], ['clip', 30]]);
    await world.redo();
    expect(clipById(world.doc(), made).duration.value).toBe(20);
  });

  it('snaps to the beat inside the clip when asked, and refuses a split by an end', async () => {
    const world = await editorWorld(three);
    const [, second] = world.built.ids;
    expect((await world.run(EDITOR_COMMANDS.splitClip, { clipId: second, at: f(37), snapToBeat: true })).ok).toBe(true);
    expect(shape(world.doc())).toEqual([['clip', 30], ['clip', 15], ['clip', 15], ['clip', 30]]);
    const near = await world.run(EDITOR_COMMANDS.splitClip, { clipId: world.built.ids[0], at: f(2) });
    expect(!near.ok && near.error.code).toBe('timeline.invalid_move');
  });

  it('refuses a split time outside the clip, snapped or not, saying where the clip plays (EDT1-OPS)', async () => {
    const world = await editorWorld(three);
    const [, second] = world.built.ids;
    // Eval run 11: "clip 5 at 0 s" with snapToBeat split the clip at a beat inside it, where nobody asked.
    for (const snapToBeat of [true, false]) {
      const outside = await world.run(EDITOR_COMMANDS.splitClip, { clipId: second, at: f(0), snapToBeat });
      expect(!outside.ok && outside.error.detail).toMatch(/Clip 2 plays from 1 s to 2 s of the video/);
    }
    expect(shape(world.doc())).toEqual([['clip', 30], ['clip', 30], ['clip', 30]]);
  });

  it('refuses a split at the clip’s exact start or end, snapped or not, never snapping it inside (EDT1-OPS)', async () => {
    const world = await editorWorld(three);
    const [, second] = world.built.ids;
    // Eval run 14: "clip 5 at 7 s", the second half's own start, with snapToBeat split the waves a third time.
    for (const at of [30, 60]) {
      for (const snapToBeat of [true, false]) {
        const edge = await world.run(EDITOR_COMMANDS.splitClip, { clipId: second, at: f(at), snapToBeat });
        expect(!edge.ok && edge.error.detail).toMatch(/Clip 2 plays from 1 s to 2 s of the video/);
      }
    }
    expect(shape(world.doc())).toEqual([['clip', 30], ['clip', 30], ['clip', 30]]);
    // A time inside still snaps to the beat nearest it.
    expect((await world.run(EDITOR_COMMANDS.splitClip, { clipId: second, at: f(44), snapToBeat: true })).ok).toBe(true);
    expect(shape(world.doc())).toHaveLength(4);
  });

  it('leaves a clip the person locked to the person', async () => {
    const world = await editorWorld({ clips: [{ frames: 30 }, { frames: 30, locked: true }] });
    const refused = await world.run(EDITOR_COMMANDS.splitClip, { clipId: world.built.ids[1], at: f(45) }, agentOrigin);
    expect(!refused.ok && refused.error.code).toBe('timeline.clip_locked');
    expect((await world.run(EDITOR_COMMANDS.splitClip, { clipId: world.built.ids[1], at: f(45) })).ok).toBe(true);
  });
});

describe('timeline.deleteClip', () => {
  it('ripples by default: what follows closes up, text with it, and the slot keeps its pick as dropped', async () => {
    const world = await editorWorld(three);
    const [, second] = world.built.ids;
    expect((await world.run(EDITOR_COMMANDS.deleteClip, { clipId: second })).ok).toBe(true);
    expect(shape(world.doc())).toEqual([['clip', 30], ['clip', 30]]);
    expect(text(world.doc())).toEqual([30, 20]);
    expect(world.doc().cast?.slots[1]).toMatchObject({ clipId: null, note: 'dropped' });
    await world.undo();
    expect(shape(world.doc())).toHaveLength(3);
    expect(text(world.doc())).toEqual([60, 20]);
  });

  it('lifts on request: a gap of the same length and slot stays, nothing moves', async () => {
    const world = await editorWorld({ clips: [{ frames: 30 }, { frames: 30, transition: ['dissolve', 5, 5] }, { frames: 30 }] });
    const [, second] = world.built.ids;
    expect((await world.run(EDITOR_COMMANDS.deleteClip, { clipId: second, mode: 'lift' })).ok).toBe(true);
    expect(shape(world.doc())).toEqual([['clip', 30], ['gap', 30], ['clip', 30]]);
    const video = world.doc().tracks[0];
    expect(video?.kind === 'video' && video.items[1]).toMatchObject({ type: 'gap', id: second, slotId: world.built.slots[1] });
    expect(world.doc().cast?.slots[1]?.clipId).toBeNull();
  });
});

describe('timeline.insertClip', () => {
  it('splits the clip at a time inside it and ripples the rest, every cut still on the beat', async () => {
    const world = await editorWorld(three);
    const shot = world.shots[0]!;
    const inserted = await world.run(EDITOR_COMMANDS.insertClip, {
      media: { kind: 'video', assetId: shot.assetId, shotId: shot.shotId },
      position: { kind: 'time', at: f(45) },
    });
    expect(inserted.ok).toBe(true);
    const id = inserted.ok ? (inserted.value as { itemId: string }).itemId : '';
    expect(shape(world.doc())).toEqual([['clip', 30], ['clip', 15], ['clip', 30], ['clip', 15], ['clip', 30]]);
    expect(clipById(world.doc(), id).media.assetId).toBe(shot.assetId);
    expect(onGrid(world.doc())).toBe(true);
    expect(text(world.doc())).toEqual([90, 20]);
    await world.undo();
    expect(shape(world.doc())).toEqual([['clip', 30], ['clip', 30], ['clip', 30]]);
    await world.redo();
    expect(clipById(world.doc(), id).duration.value).toBe(30);
  });

  it('puts a length that is off the beat back on it, so the template’s grid holds after the ripple', async () => {
    const world = await editorWorld(three);
    const shot = world.shots[0]!;
    const inserted = await world.run(EDITOR_COMMANDS.insertClip, {
      media: { kind: 'video', assetId: shot.assetId, shotId: shot.shotId, sourceStart: f(40) },
      position: { kind: 'after', itemId: world.built.ids[0] },
      duration: f(20),
    });
    expect(inserted.ok).toBe(true);
    expect(onGrid(world.doc())).toBe(true);
    const id = inserted.ok ? (inserted.value as { itemId: string }).itemId : '';
    expect(clipById(world.doc(), id).sourceStart.value).toBe(40);
  });

  it('takes a photo before a slot, or at the start, with a gentle push', async () => {
    const world = await editorWorld(three);
    const photo = await world.run(EDITOR_COMMANDS.insertClip, {
      media: { kind: 'image', assetId: world.shots[0]!.assetId },
      position: { kind: 'slot', slotId: world.built.slots[2] },
      duration: f(15),
    });
    expect(photo.ok).toBe(true);
    const id = photo.ok ? (photo.value as { itemId: string }).itemId : '';
    const clip = clipById(world.doc(), id) as Clip;
    expect([clip.media.kind, clip.stillMotion, starts(world.doc())[2]]).toEqual(['image', 'pushIn', 60]);
    const missing = await world.run(EDITOR_COMMANDS.insertClip, {
      media: { kind: 'image', assetId: world.shots[0]!.assetId },
      position: { kind: 'before', itemId: world.built.slots[0] },
    });
    expect(!missing.ok && missing.error.code).toBe('timeline.item_not_found');
  });

  it('answers media_missing for a shot the library doesn’t have', async () => {
    const world = await editorWorld(three);
    const gone = await world.run(EDITOR_COMMANDS.insertClip, {
      media: { kind: 'video', assetId: world.built.ids[0], shotId: null },
      position: { kind: 'time', at: f(0) },
    });
    expect(!gone.ok && gone.error.code).toBe('timeline.media_missing');
  });
});

describe('timeline.duplicateClip', () => {
  it('puts a copy right after the clip, a new id without a slot, and moves what follows', async () => {
    const world = await editorWorld(three);
    const [first] = world.built.ids;
    const copied = await world.run(EDITOR_COMMANDS.duplicateClip, { clipId: first });
    const id = copied.ok ? (copied.value as { itemId: string }).itemId : '';
    expect(shape(world.doc())).toEqual([['clip', 30], ['clip', 30], ['clip', 30], ['clip', 30]]);
    const copy = clipById(world.doc(), id);
    expect([copy.slotId, copy.media.assetId]).toEqual([null, clipById(world.doc(), first as string).media.assetId]);
    expect(text(world.doc())).toEqual([90, 20]);
    expect(world.doc().cast?.slots.map((slot) => slot.clipId)).toEqual(world.built.ids);
  });
});
