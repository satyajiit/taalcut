// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B8, timeline part: every empty slot can take each fix. Fill with a still (each motion), a video and a
 * too-short video; drop by ripple and by extend at the start, middle and end, with transitions, text and caption
 * cues around; every cut still on its beat; one ⌘Z each; and the gap list and shot list the agent and the phone
 * read.
 */
import { FrameRates, newId, RationalTime, STILL_MOTIONS, type CaptionTrack, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { gapsOf, shotList } from '../../src/gaps/gaps';
import { positions, videoItems } from '../../src/model/sequence';
import { agentOrigin, commandWorld, ui } from '../fixtures/command-world';
import { makeProfile, unitVector } from '../fixtures/library';
import { buildTimeline, starts } from '../fixtures/timeline';

const f = (value: number) => RationalTime.of(value, FrameRates.fps30);

/** clip · (dissolve) clip · gap · clip · gap · clip, every cut on a 15-frame beat; text and a caption cue. */
function fixture(): { timeline: Timeline; ids: string[]; slots: string[] } {
  const built = buildTimeline({
    clips: [
      { frames: 30 },
      { frames: 30, transition: ['dissolve', 4, 4] },
      { frames: 15, gap: true },
      { frames: 30 },
      { frames: 30, gap: true },
      { frames: 45 },
    ],
    texts: [{ start: 45, frames: 30, slot: 1 }, { start: 150, frames: 15 }],
  });
  const captions: CaptionTrack = {
    enabled: true,
    language: 'en',
    style: {
      version: 1,
      font: 'notoSans',
      weight: 700,
      sizePx: 64,
      textColor: '#ffffff',
      highlightColor: '#ffcc00',
      stroke: null,
      background: null,
      highlight: 'color',
      letterCase: 'asIs',
      anchorY: 0.7,
      maxLines: 2,
      maxWords: 4,
    },
    styleSource: 'preset',
    cues: [
      {
        id: newId<'CaptionCue'>(),
        range: { start: f(30), duration: f(60) },
        words: [
          { text: 'in', range: { start: f(30), duration: f(10) }, confidence: 1 },
          { text: 'the', range: { start: f(50), duration: f(10) }, confidence: 1 },
          { text: 'middle', range: { start: f(80), duration: f(10) }, confidence: 1 },
        ],
        edited: false,
      },
    ],
  };
  return { timeline: { ...built.timeline, captions }, ids: built.ids, slots: built.slots };
}

const target = (timeline: Timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id });
const beats = (timeline: Timeline) => starts(timeline).every((frame) => frame % 15 === 0);

describe('gap list and shot list', () => {
  it('lists every gap with its slot, number, place and note; the shot list adds slots marked for filming', async () => {
    const { timeline, ids, slots } = fixture();
    const gaps = gapsOf(timeline, null);
    expect(gaps.map((gap) => [gap.gapId, gap.number, gap.start.value, gap.duration.value, gap.note])).toEqual([
      [ids[2], 3, 60, 15, 'noCandidates'],
      [ids[4], 5, 105, 30, 'noCandidates'],
    ]);
    const world = commandWorld();
    await world.seed(timeline);
    const marked = await world.dispatch('timeline.markForFilming', { ...target(timeline), slotIds: [slots[5]], on: true });
    expect(marked.ok).toBe(true);
    const list = shotList(world.doc(timeline.id), null);
    expect(list.map((row) => [row.number, row.seconds, row.orientation])).toEqual([
      [3, 0.5, 'portrait'],
      [5, 1, 'portrait'],
      [6, 1.5, 'portrait'],
    ]);
    await world.bus.undo(timeline.projectId, ui);
    expect(shotList(world.doc(timeline.id), null)).toHaveLength(2);
  });
});

describe('timeline.fillGap', () => {
  it.each(STILL_MOTIONS)('fills a gap with a still that moves %s, keeping its id, slot and beat; one undo', async (motion) => {
    const { timeline, ids } = fixture();
    const world = commandWorld();
    await world.seed(timeline);
    const asset = makeProfile({ kind: 'image', embedding: unitVector(1) }).assetId;
    const done = await world.dispatch('timeline.fillGap', {
      ...target(timeline),
      gapId: ids[2],
      media: { kind: 'image', assetId: asset, stillMotion: motion },
    });
    if (!done.ok) throw new Error(done.error.code);
    const filled = videoItems(world.doc(timeline.id)).find((item) => item.id === ids[2]);
    expect(filled).toMatchObject({ type: 'clip', media: { kind: 'image', assetId: asset }, stillMotion: motion, duration: { value: 15 } });
    expect(filled?.type === 'clip' && filled.beatAnchor?.beatIndex).toBe(4);
    const slot = world.doc(timeline.id).cast?.slots[2];
    expect(slot).toMatchObject({ clipId: ids[2], note: 'gapFilled', pick: { assetId: asset } });
    expect(starts(world.doc(timeline.id))).toEqual(starts(timeline));
    await world.bus.undo(timeline.projectId, ui);
    expect({ ...world.doc(timeline.id), revision: 1, updatedAt: 0 }).toEqual({ ...timeline, revision: 1, updatedAt: 0 });
  });

  it('fills a gap with a video at the in-point rule, and refuses one too short or a clip', async () => {
    const { timeline, ids } = fixture();
    const long = makeProfile({ frames: 300, embedding: unitVector(2) });
    const short = makeProfile({ frames: 10, embedding: unitVector(3) });
    const world = commandWorld({ catalog: createMemoryShotCatalog([long, short]) });
    await world.seed(timeline);
    const done = await world.dispatch('timeline.fillGap', {
      ...target(timeline),
      gapId: ids[4],
      media: { kind: 'video', assetId: long.assetId, shotId: long.shotId },
    });
    if (!done.ok) throw new Error(done.error.code);
    const clip = videoItems(world.doc(timeline.id)).find((item) => item.id === ids[4]);
    expect(clip?.type === 'clip' && clip.media.kind).toBe('video');
    expect(clip?.type === 'clip' && clip.duration.value).toBe(30);
    const tooShort = await world.dispatch('timeline.fillGap', {
      ...target(timeline),
      gapId: ids[2],
      media: { kind: 'video', assetId: short.assetId, shotId: short.shotId },
    });
    expect(!tooShort.ok && tooShort.error.code).toBe('timeline.media_too_short');
    const notGap = await world.dispatch('timeline.fillGap', {
      ...target(timeline),
      gapId: ids[0],
      media: { kind: 'image', assetId: long.assetId, stillMotion: 'none' },
    });
    expect(!notGap.ok && notGap.error.code).toBe('timeline.not_a_gap');
    const gone = await world.dispatch('timeline.fillGap', {
      ...target(timeline),
      gapId: newId<'TimelineItem'>(),
      media: { kind: 'image', assetId: long.assetId, stillMotion: 'none' },
    });
    expect(!gone.ok && gone.error.code).toBe('timeline.gap_not_found');
  });
});

describe('timeline.dropSlot', () => {
  it.each([
    ['start', 0, [0, 30, 45, 75, 105, 150]],
    ['middle (a gap)', 2, [0, 30, 60, 90, 120, 165]],
    ['middle (a clip after a dissolve)', 1, [0, 30, 45, 75, 105, 150]],
    ['end', 5, [0, 30, 60, 75, 105, 135]],
  ] as const)('ripples out the %s: later cuts move earlier and stay on beats; one undo', async (_where, index, cuts) => {
    const { timeline, ids, slots } = fixture();
    const world = commandWorld();
    await world.seed(timeline);
    const done = await world.dispatch('timeline.dropSlot', { ...target(timeline), itemId: ids[index], mode: 'ripple' });
    if (!done.ok) throw new Error(done.error.detail ?? done.error.code);
    const after = world.doc(timeline.id);
    expect(starts(after)).toEqual(cuts);
    expect(beats(after)).toBe(true);
    expect(videoItems(after).some((item) => item.type === 'transition')).toBe(index > 1);
    expect(after.cast?.slots.find((slot) => slot.slotId === slots[index])).toMatchObject({ clipId: null, note: 'dropped' });
    for (const position of positions(videoItems(after)))
      if (position.item.type === 'clip') expect(position.item.beatAnchor?.beatIndex).toBe(position.start / 15);
    await world.bus.undo(timeline.projectId, ui);
    const undone = world.doc(timeline.id);
    expect({ ...undone, revision: 1, updatedAt: 0 }).toEqual({ ...timeline, revision: 1, updatedAt: 0 });
  });

  it('moves text and caption cues with the ripple and drops what was inside the dropped span', async () => {
    const { timeline, ids } = fixture();
    const texts = (doc: Timeline) =>
      doc.tracks.filter((track) => track.kind === 'text').flatMap((track) => track.items.map((item) => [item.start.value, item.duration.value]));
    const words = (doc: Timeline) => doc.captions?.cues[0]?.words.map((word) => [word.text, word.range.start.value]);
    const gap = commandWorld();
    await gap.seed(timeline);
    await gap.dispatch('timeline.dropSlot', { ...target(timeline), itemId: ids[2], mode: 'ripple' });
    expect(texts(gap.doc(timeline.id))).toEqual([[45, 15], [135, 15]]);
    expect(words(gap.doc(timeline.id))).toEqual([['in', 30], ['the', 50], ['middle', 65]]);
    const clip = commandWorld();
    await clip.seed(timeline);
    await clip.dispatch('timeline.dropSlot', { ...target(timeline), itemId: ids[1], mode: 'ripple' });
    expect(texts(clip.doc(timeline.id))).toEqual([[30, 15], [120, 15]]);
    expect(words(clip.doc(timeline.id))).toEqual([['middle', 50]]);
    expect(clip.doc(timeline.id).captions?.cues[0]?.range.duration.value).toBe(30);
  });

  it('lets the clip before cover the dropped slot, else the clip after; refuses an agent on a locked clip', async () => {
    const { timeline, ids } = fixture();
    const world = commandWorld();
    await world.seed(timeline);
    await world.dispatch('timeline.dropSlot', { ...target(timeline), itemId: ids[2], mode: 'extendPrevious' });
    expect(starts(world.doc(timeline.id))).toEqual([0, 30, 75, 105, 135, 180]);
    expect(videoItems(world.doc(timeline.id)).find((item) => item.id === ids[1])).toMatchObject({ duration: { value: 45 } });
    await world.bus.undo(timeline.projectId, ui);
    const first = await world.dispatch('timeline.dropSlot', { ...target(timeline), itemId: ids[0], mode: 'extendPrevious' });
    expect(first.ok).toBe(true);
    expect(starts(world.doc(timeline.id))).toEqual([0, 60, 75, 105, 135, 180]);
    expect(videoItems(world.doc(timeline.id))[0]).toMatchObject({ id: ids[1], sourceStart: { value: 70 } });
    await world.bus.undo(timeline.projectId, ui);
    await world.dispatch('timeline.lockClip', { ...target(timeline), clipId: ids[0], locked: true });
    const refused = await world.dispatch('timeline.dropSlot', { ...target(timeline), itemId: ids[0], mode: 'ripple' }, agentOrigin);
    expect(!refused.ok && refused.error.code).toBe('timeline.clip_locked');
  });
});
