// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: comments follow their anchors as the timeline is written. A move needs nothing; a split takes a moment to
 * the part that holds it; a deleted item's comment becomes a range at its last time; an undone split gives it back
 * to the whole clip; a clip that grew over a dropped one doesn't take its comments.
 */
import {
  newId,
  unwrap,
  type Clip,
  type SequenceItem,
  type Timeline,
  type TimelineComment,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { followComments } from '../../src/index';
import { at } from '../stores/documents';
import { clips, itemTarget, setup } from './comment-setup';

const withVideo = (timeline: Timeline, items: SequenceItem[], revision = timeline.revision + 1): Timeline => {
  const [video, ...rest] = timeline.tracks;
  return { ...timeline, revision, tracks: [{ ...video!, items } as Timeline['tracks'][number], ...rest] };
};

/** `clip` cut at `frames`: the first part keeps its id unless `renumber`. */
function split(clip: Clip, frames: number, renumber = false): [Clip, Clip] {
  const first = { ...clip, ...(renumber ? { id: newId<'TimelineItem'>() } : {}), duration: at(frames) };
  const second = {
    ...clip,
    id: newId<'TimelineItem'>(),
    sourceStart: { ...clip.sourceStart, value: clip.sourceStart.value + frames },
    duration: at(clip.duration.value - frames),
  };
  return [first, second];
}

function comment(timeline: Timeline, anchorId: string, frames?: number): TimelineComment {
  return {
    id: newId<'TimelineComment'>(),
    projectId: timeline.projectId,
    timelineId: timeline.id,
    anchor: itemTarget(timeline, anchorId),
    ...(frames !== undefined ? { at: at(frames) } : {}),
    body: 'Slower here',
    author: 'user',
    status: 'open',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('comments follow their anchors (EDT1-CMT)', async () => {
  const { timeline } = await setup();
  const [a, b] = clips(timeline) as [Clip, Clip];
  const gap = timeline.tracks[0]!.items[2] as SequenceItem;

  it('stay put when their clip moves', () => {
    const swapped = withVideo(timeline, [b, a, gap]);
    expect(followComments([comment(timeline, a.id, 20)], { before: timeline, after: swapped }, 9)).toEqual(
      [],
    );
  });

  it('go with a split to the part that holds their moment', () => {
    const [first, second] = split(a, 30);
    const after = withVideo(timeline, [first, second, b, gap]);
    const late = comment(timeline, a.id, 45);
    const early = comment(timeline, a.id, 10);
    const [moved, ...rest] = followComments([late, early], { before: timeline, after }, 9);
    expect(rest).toEqual([]);
    expect(moved).toMatchObject({
      id: late.id,
      anchor: { itemId: second.id },
      at: { value: 15 },
      updatedAt: 9,
    });
  });

  it('find their part when a split renumbered both halves', () => {
    const [first, second] = split(a, 30, true);
    const after = withVideo(timeline, [first, second, b, gap]);
    const whole = comment(timeline, a.id);
    const late = comment(timeline, a.id, 50);
    const moved = followComments([whole, late], { before: timeline, after }, 9);
    expect(moved.map((c) => c.anchor)).toMatchObject([{ itemId: first.id }, { itemId: second.id }]);
    expect(moved[1]!.at?.value).toBe(20);
  });

  it('come back to the whole clip when a split is undone', () => {
    const [first, second] = split(a, 30);
    const cut = withVideo(timeline, [first, second, b, gap]);
    const onSecond = comment(cut, second.id, 5);
    const [moved] = followComments([onSecond], { before: cut, after: { ...timeline, revision: 3 } }, 9);
    expect(moved).toMatchObject({ anchor: { kind: 'item', itemId: a.id }, at: { value: 35 } });
  });

  it('become a range at the deleted clip’s last time', () => {
    const after = withVideo(timeline, [a, gap]);
    const [moved] = followComments([comment(timeline, b.id, 6)], { before: timeline, after }, 9);
    expect(moved?.anchor).toMatchObject({
      kind: 'range',
      range: { start: { value: 60 }, duration: { value: 60 } },
    });
    expect(moved?.at?.value).toBe(6);
  });

  it('don’t move to a clip that grew over a dropped one', () => {
    const longer = { ...a, duration: at(120) };
    const after = withVideo(timeline, [longer, gap]);
    const [moved] = followComments([comment(timeline, b.id)], { before: timeline, after }, 9);
    expect(moved?.anchor.kind).toBe('range');
  });

  it('keep a moment a trim cut off at the clip’s last frame', () => {
    const after = withVideo(timeline, [{ ...a, duration: at(40) }, b, gap]);
    const [moved] = followComments([comment(timeline, a.id, 50)], { before: timeline, after }, 9);
    expect(moved).toMatchObject({ anchor: { itemId: a.id }, at: { value: 39 } });
  });
});

describe('the timeline store moves comments as it writes', () => {
  it('in the same write, and back again with the version put back', async () => {
    const { timelines, timeline, add, get } = await setup();
    const [, b] = clips(timeline) as [Clip, Clip];
    const { commentId } = await add({ anchor: itemTarget(timeline, b.id), at: 6 });
    const gap = timeline.tracks[0]!.items[2] as SequenceItem;
    unwrap(await timelines.put(withVideo(timeline, [clips(timeline)[0]!, gap]), timeline.revision));
    expect((await get(commentId)).anchor).toMatchObject({ kind: 'range', range: { start: { value: 60 } } });
    const ranged = await get(commentId);
    unwrap(await timelines.put({ ...timeline, revision: 2 }, 2));
    expect((await get(commentId)).anchor).toEqual(ranged.anchor);
  });
});
