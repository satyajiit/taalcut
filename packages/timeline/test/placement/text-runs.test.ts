// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: where a made video's text starts. The owner's lyric (seven words shown one after another at one place, over
 * clips whose people stand in different places) was solved a word at a time and wandered: "one small, one large,
 * one at top, one centre". Here the same reel, made up: the run starts together where the reel had it, at one size,
 * whatever is in the clips; the solver's place for it is a candidate that changes nothing.
 */
import { describe, expect, it } from 'vitest';
import type { CommandOrigin, TextItem } from '@taalcut/core';
import { intersects, toPixels, type Rect } from '../../src/assembly/placement/geometry';
import { candidatePlaces } from '../../src/assembly/placement/place-timeline';
import { runPlacement, spansFor } from '../../src/assembly/placement/run-placement';
import { runAlign } from '../../src/assembly/placement/runs';
import { clipSourceRange, placedClips } from '../../src/assembly/placement/subjects';
import type { FakeBox } from './fake-subjects';
import {
  CANVAS,
  centreOf,
  LINE,
  lyricVideo,
  madeVideo,
  spreadOf,
  textWorld,
  TURN,
  WORD_WIDTHS,
  WORDS,
  wordsOf,
  type HeadsByClip,
} from './lyric-world';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const px = (box: FakeBox): Rect => toPixels(box, CANVAS);

/** Four clips: a head left of the middle, one right on the reel's line, nobody, one right of the middle. */
const HEADS: HeadsByClip = [
  [{ x: 0.16, y: 0.36, width: 0.28, height: 0.17 }],
  [{ x: 0.37, y: 0.4, width: 0.26, height: 0.16 }],
  [],
  [{ x: 0.58, y: 0.33, width: 0.28, height: 0.17 }],
];
const ALL_HEADS = HEADS.flat();

/** The people in the video's clips, as the tools read them. */
async function peopleOf(video: Awaited<ReturnType<typeof lyricVideo>>) {
  const { timeline, subjects } = video;
  const rate = timeline.canvas.rate;
  return spansFor(
    subjects,
    placedClips(timeline).flatMap((placed) =>
      placed.clip.media.kind === 'video'
        ? [
            {
              key: placed.clip.id,
              range: { assetId: placed.clip.media.assetId, ...clipSourceRange(placed.clip, rate) },
            },
          ]
        : [],
    ),
    [],
    { subjects },
  );
}

describe('the owner’s lyric, made up: seven words in turn at one place', () => {
  it('starts together: one place and one size, where the reel had the run, whoever is in the clips', async () => {
    const video = await lyricVideo(HEADS);
    const words = wordsOf(video.timeline);
    expect(words).toHaveLength(7);
    const centres = words.map(centreOf);
    // One line and one centre, to the rounding of a stored box (a ten-thousandth of the frame).
    expect(spreadOf(centres.map((centre) => centre.y))).toBeLessThanOrEqual(2e-4);
    expect(spreadOf(centres.map((centre) => centre.x))).toBeLessThanOrEqual(2e-4);
    // The reel's own line and size, though a head is right on that line in the second clip.
    for (const centre of centres) {
      expect(centre.y).toBeCloseTo(LINE.middle, 3);
      expect(centre.x).toBeCloseTo(0.5, 3);
    }
    expect(new Set(words.map((word) => word.appearance.size))).toEqual(new Set([LINE.size]));
    expect(words.every((word) => word.appearance.align === 'center')).toBe(true);
    // Laid out as the reel had it, and nobody has placed it yet.
    expect(words.every((word) => word.placement?.reason === 'asReel' && word.placedBy === undefined)).toBe(
      true,
    );
  });

  it('is the same however often it is laid out, with the people known or not', async () => {
    const video = await lyricVideo(HEADS);
    const again = runPlacement(video.timeline, video.w.template, { subjects: video.subjects });
    expect(wordsOf(again)).toEqual(wordsOf(video.timeline));
    const nobody = runPlacement(video.timeline, video.w.template, {});
    expect(wordsOf(nobody)).toEqual(wordsOf(video.timeline));
  });

  it('a run the reel measured at slightly different sizes is one size: the middle one', async () => {
    const sizes = [0.0284, 0.0279, 0.029, 0.0284, 0.0281, 0.0288, 0.0284];
    const world = textWorld(
      WORDS.map((text, index) => ({
        text,
        start: index * TURN,
        frames: TURN,
        box: {
          x: 0.5 - WORD_WIDTHS[index]! / 2,
          y: LINE.middle - LINE.height / 2,
          width: WORD_WIDTHS[index]!,
          height: LINE.height,
        },
        size: sizes[index]!,
      })),
    );
    const words = wordsOf((await madeVideo(world, HEADS)).timeline);
    expect(new Set(words.map((word) => word.appearance.size))).toEqual(new Set([0.0284]));
    expect(spreadOf(words.map((word) => centreOf(word).y))).toBeLessThanOrEqual(2e-4);
  });

  it('a run set flush left in the reel keeps one left edge', async () => {
    const video = await lyricVideo(HEADS, { anchor: { edge: 'left', at: 0.12 } });
    const words = wordsOf(video.timeline);
    expect(spreadOf(words.map((word) => word.box.x))).toBeLessThanOrEqual(2e-4);
    expect(words[0]!.box.x).toBeCloseTo(0.12, 3);
    expect(words.every((word) => word.appearance.align === 'left')).toBe(true);
    expect(
      runAlign([
        px({ x: 0.1, y: 0.4, width: 0.3, height: 0.04 }),
        px({ x: 0.1, y: 0.4, width: 0.2, height: 0.04 }),
      ]),
    ).toBe('left');
  });

  it('a small size the reel had is kept as it is: nothing raises it', async () => {
    const video = await lyricVideo(HEADS, { size: 0.0073, middle: 0.86 });
    const words = wordsOf(video.timeline);
    expect(new Set(words.map((word) => word.appearance.size))).toEqual(new Set([0.0073]));
    for (const word of words) expect(centreOf(word).y).toBeCloseTo(0.86, 3);
  });
});

describe('the solver’s place is a candidate', () => {
  it('one place for the whole run, clear of every head on every clip it crosses; nothing is changed', async () => {
    const video = await lyricVideo(HEADS);
    const before = wordsOf(video.timeline);
    const [candidate] = candidatePlaces({
      timeline: video.timeline,
      template: video.w.template,
      subjects: await peopleOf(video),
    });
    const words = candidate!.items.filter((item): item is TextItem => item.type === 'text');
    expect(words).toHaveLength(7);
    expect(spreadOf(words.map((word) => centreOf(word).y))).toBeLessThanOrEqual(2e-4);
    for (const word of words)
      for (const head of ALL_HEADS) expect(intersects(px(word.box), px(head))).toBe(false);
    expect(candidate!.reason).not.toBe('noRoom');
    expect(wordsOf(video.timeline)).toEqual(before);
  });

  it('heads everywhere: the least covered place, with the share of frames a head is under it', async () => {
    const wall: FakeBox = { x: 0.02, y: 0.03, width: 0.96, height: 0.94 };
    const video = await lyricVideo([[wall], [], [], []]);
    const [candidate] = candidatePlaces({
      timeline: video.timeline,
      template: video.w.template,
      subjects: await peopleOf(video),
    });
    expect(candidate!.reason).toBe('noRoom');
    // The wall is under the run only while its own clip is on: a share of the frames, not all of them.
    expect(candidate!.covered).toBeGreaterThan(0);
    expect(candidate!.covered).toBeLessThan(0.6);
  });
});

describe('a run after an edit', () => {
  it('new words for one text: the run stays together where the reel had it', async () => {
    const video = await lyricVideo(HEADS);
    const { w, timeline } = video;
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const third = wordsOf(timeline)[2]!;
    const edited = await w.bus.dispatch(
      'timeline.editText',
      { ...target, itemId: third.id, text: 'Disappear' },
      ui,
    );
    expect(edited.ok).toBe(true);
    const words = wordsOf(w.store.docs.get(timeline.id)!);
    expect(words[2]!.text).toBe('Disappear');
    expect(spreadOf(words.map((word) => centreOf(word).y))).toBeLessThanOrEqual(2e-4);
    expect(spreadOf(words.map((word) => centreOf(word).x))).toBeLessThanOrEqual(2e-4);
    expect(centreOf(words[2]!).y).toBeCloseTo(LINE.middle, 3);
  });

  it('a word the person dragged stays where they put it, through a later layout of its run', async () => {
    const video = await lyricVideo(HEADS);
    const { w, timeline } = video;
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const [first, second] = wordsOf(timeline) as [TextItem, TextItem];
    const mine = { x: 0.3, y: 0.2, width: 0.4, height: 0.05 };
    const moved = await w.bus.dispatch('timeline.moveText', { ...target, itemId: first.id, box: mine }, ui);
    expect(moved.ok).toBe(true);
    const dragged = wordsOf(w.store.docs.get(timeline.id)!)[0]!;
    expect(dragged.placedBy).toBe('person');
    expect(dragged.placement).toBeUndefined();
    // New words for another text of the run: the run is laid out again, without the person's word.
    const again = await w.bus.dispatch(
      'timeline.editText',
      { ...target, itemId: second.id, text: 'You all' },
      ui,
    );
    expect(again.ok).toBe(true);
    const words = wordsOf(w.store.docs.get(timeline.id)!);
    expect(words[0]!.box).toEqual(mine);
    expect(words[0]!.placedBy).toBe('person');
    expect(spreadOf(words.slice(1).map((word) => centreOf(word).y))).toBeLessThanOrEqual(2e-4);
  });
});
