// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: the AI places a made video's text. `timeline.placeText` applies the place, alignment and size stated for
 * each group exactly, and answers with facts; it refuses no place and no size. Nothing automatic moves a text that
 * was placed, and the make's finish (`checkVideoDone`) holds a video until every text has a stated place, without
 * judging any.
 */
import { describe, expect, it } from 'vitest';
import type { CommandOrigin, TextItem } from '@taalcut/core';
import { runPlacement } from '../src/assembly/placement/run-placement';
import { fitWords } from '../src/assembly/placement/text-size';
import { platformsOver } from '../src/assembly/platform-areas';
import { checkVideoDone } from '../src/match/video-done';
import { HEAVY, measuredWorld, styledVideo } from './fixtures/text-design';
import { CANVAS, centreOf, LINE, spreadOf, wordsOf, type HeadsByClip } from './placement/lyric-world';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

/** Four clips: a head left of the middle, one right on the reel's line, nobody, one right of the middle. */
const HEADS: HeadsByClip = [
  [{ x: 0.16, y: 0.36, width: 0.28, height: 0.17 }],
  [{ x: 0.37, y: 0.4, width: 0.26, height: 0.16 }],
  [],
  [{ x: 0.58, y: 0.33, width: 0.28, height: 0.17 }],
];

type Group = Record<string, unknown>;
const groupsOf = (value: Record<string, unknown>) => value.groups as Group[];

describe('timeline.textLook lists the groups', () => {
  it('a run is one group: where it sits, the reel’s place, what is under it, and a candidate', async () => {
    const { w, target, now } = await styledVideo(HEADS);
    const read = await w.call('timeline.textLook', target);
    if (!read.ok) throw new Error(read.error.code);
    const [group, ...others] = groupsOf(read.value);
    expect(others).toEqual([]);
    const reel = { x: 0.5, y: 0.48, align: 'center', size: 0.0284, capPx: 55 };
    expect(group).toEqual({
      group: wordsOf(now())[0]!.id,
      role: 'label',
      texts: 7,
      run: true,
      example: 'I hope',
      fromSeconds: 0,
      toSeconds: 2.8,
      ...reel,
      placedBy: 'nobody',
      // Each word on its one line, no width stated to wrap at.
      lines: [1, 1, 1, 1, 1, 1, 1],
      wrapAt: null,
      widerThanFrame: false,
      atFrameEdge: false,
      // A head is under the reel's line in three of the four clips.
      under: { face: 0.75, person: 0, frames: 12 },
      coveredBy: [],
      reel,
      // The solver's place: below the lowest head. Information; the words are still on the reel's line.
      candidate: { ...reel, y: 0.6111, clear: true },
    });
    expect(read.value.unplaced).toEqual([group!.group]);
    expect(read.value.system).toBe('label: 7 texts in 1 group, 1 size (55 px), 1 place');
    expect(read.value.reading).toBe('Capitals under 36 px on this video are hard to read on a phone.');
    expect(read.value.platforms).toMatchObject({
      provisional: true,
      shorts: { x: 0.0444, y: 0.15, width: 0.7778, height: 0.5 },
      tiktok: { x: 0.1111, y: 0.125, width: 0.6111, height: 0.5313 },
    });
  });

  it('the platforms’ areas are facts for a 9:16 video only, and say nothing for another shape', () => {
    const low = { x: 0.3, y: 0.8, width: 0.4, height: 0.05 };
    expect(platformsOver(low, { width: 1080, height: 1920 })).toEqual(['shorts', 'reels', 'tiktok']);
    // Inside every platform's rows, but right of TikTok's and Shorts' clear part.
    const right = { x: 0.6, y: 0.3, width: 0.3, height: 0.05 };
    expect(platformsOver(right, { width: 1080, height: 1920 })).toEqual(['shorts', 'tiktok']);
    expect(platformsOver(low, { width: 1920, height: 1080 })).toEqual([]);
  });
});

describe('timeline.placeText applies what is stated', () => {
  it('a place and a size exactly, y 0.86 and size 0.0073 too, with the facts and no refusal', async () => {
    const { w, target, now } = await styledVideo(HEADS);
    const first = wordsOf(now())[0]!;
    const done = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: first.id, x: 0.5, y: 0.86, align: 'center', size: 0.0073 }],
    });
    if (!done.ok) throw new Error(`${done.error.code} ${done.error.detail ?? ''}`);
    const words = wordsOf(now());
    for (const word of words) {
      expect(centreOf(word).x).toBeCloseTo(0.5, 9);
      expect(centreOf(word).y).toBeCloseTo(0.86, 9);
      expect(word.appearance.size).toBe(0.0073);
      expect(word.placedBy).toBe('editor');
      expect(word.placement).toBeUndefined();
    }
    // Each word's box is its words' own at the size stated: the reel's 55 px capitals are 14 px now.
    expect(words[0]!.box.width).toBeCloseTo(fitWords(first.text, 0.0073, CANVAS).width / CANVAS.width, 9);
    expect(words.every((word) => word.breaks === 'written')).toBe(true);
    expect(groupsOf(done.value)).toEqual([
      expect.objectContaining({
        group: first.id,
        texts: 7,
        x: 0.5,
        y: 0.86,
        align: 'center',
        size: 0.0073,
        capPx: 14,
        placedBy: 'ai',
        lines: [1, 1, 1, 1, 1, 1, 1],
        wrapAt: null,
        widerThanFrame: false,
        atFrameEdge: false,
        under: { face: 0, person: 0, frames: 12 },
        coveredBy: ['shorts', 'reels', 'tiktok'],
        reel: { x: 0.5, y: 0.48, align: 'center', size: 0.0284, capPx: 55 },
      }),
    ]);
    expect(done.value.unplaced).toEqual([]);
    expect(done.value.system).toBe('label: 7 texts in 1 group, 1 size (14 px), 1 place');
    expect(done.value.reading).toBe('Capitals under 36 px on this video are hard to read on a phone.');
    expect(done.value.platformsNote).toBe('coveredBy uses provisional areas, never matched to the apps.');
  });

  it('any text of a run names the run; a new alignment sets every word flush to the stated edge', async () => {
    const { w, target, now } = await styledVideo(HEADS);
    const fourth = wordsOf(now())[3]!;
    const done = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: fourth.id, x: 0.12, y: 0.3, align: 'left' }],
    });
    if (!done.ok) throw new Error(`${done.error.code} ${done.error.detail ?? ''}`);
    const words = wordsOf(now());
    for (const word of words) {
      expect(word.box.x).toBeCloseTo(0.12, 9);
      expect(centreOf(word).y).toBeCloseTo(0.3, 9);
      expect(word.appearance.align).toBe('left');
      // The size was not stated: it stays the run's.
      expect(word.appearance.size).toBe(LINE.size);
    }
    expect(groupsOf(done.value)[0]).toMatchObject({ x: 0.12, y: 0.3, align: 'left', atFrameEdge: false });
  });

  it('a place stated past the frame’s edge is not refused: the group sits at the edge, and the answer says so', async () => {
    const { w, target, now } = await styledVideo(HEADS);
    const done = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: wordsOf(now())[0]!.id, x: 0.9, y: 0.005, align: 'left' }],
    });
    if (!done.ok) throw new Error(`${done.error.code} ${done.error.detail ?? ''}`);
    const words = wordsOf(now());
    // A stored box lies inside the frame (core's boxSchema): the run as one moved the least that gets it there.
    expect(Math.max(...words.map((word) => word.box.x + word.box.width))).toBeCloseTo(1, 9);
    expect(Math.min(...words.map((word) => word.box.y))).toBeCloseTo(0, 9);
    expect(spreadOf(words.map((word) => word.box.x))).toBeLessThanOrEqual(1e-9);
    const [group] = groupsOf(done.value);
    expect(group).toMatchObject({ align: 'left', atFrameEdge: true, placedBy: 'ai' });
    expect(group!.x).toBeLessThan(0.9);
  });

  it('asReel states the reel’s own place and size, from wherever the group was', async () => {
    const { w, target, now } = await styledVideo(HEADS);
    const first = wordsOf(now())[0]!;
    const started = wordsOf(now()).map((word) => word.box);
    await w.call('timeline.placeText', { ...target, groups: [{ itemId: first.id, y: 0.3, size: 0.05 }] });
    expect(centreOf(wordsOf(now())[0]!).y).toBeCloseTo(0.3, 9);
    const back = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: first.id, asReel: true }],
    });
    if (!back.ok) throw new Error(`${back.error.code} ${back.error.detail ?? ''}`);
    const words = wordsOf(now());
    expect(words.map((word) => word.box)).toEqual(started);
    expect(words.every((word) => word.appearance.size === LINE.size && word.placedBy === 'editor')).toBe(
      true,
    );
    expect(back.value.unplaced).toEqual([]);
  });

  it('a text the person placed stays where the person put it; the rest of its run goes where stated', async () => {
    const { w, target, now } = await styledVideo(HEADS);
    const [first, second] = wordsOf(now()) as [TextItem, TextItem];
    const mine = { x: 0.3, y: 0.2, width: 0.4, height: 0.05 };
    await w.bus.dispatch('timeline.moveText', { ...target, itemId: first.id, box: mine }, ui);
    const done = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: second.id, y: 0.7 }],
    });
    if (!done.ok) throw new Error(`${done.error.code} ${done.error.detail ?? ''}`);
    const words = wordsOf(now());
    expect(words[0]!.box).toEqual(mine);
    expect(words[0]!.placedBy).toBe('person');
    for (const word of words.slice(1)) {
      expect(centreOf(word).y).toBeCloseTo(0.7, 9);
      expect(word.placedBy).toBe('editor');
    }
    // Naming the person's own text moves nothing of theirs either.
    await w.call('timeline.placeText', { ...target, groups: [{ itemId: first.id, y: 0.9 }] });
    expect(wordsOf(now())[0]!.box).toEqual(mine);
  });

  it('refuses only an id that is no text of this video', async () => {
    const { w, target } = await styledVideo();
    const done = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: '01HZZZZZZZZZZZZZZZZZZZZZZZ', y: 0.5 }],
    });
    expect(done.ok).toBe(false);
    if (!done.ok)
      expect(done.error.detail).toBe('No text of this video has the id 01HZZZZZZZZZZZZZZZZZZZZZZZ.');
  });
});

describe('nothing automatic moves a text that was placed', () => {
  it('new words, a later layout: the placed run is where the AI put it; one undo puts it back', async () => {
    const { w, target, now, subjects } = await styledVideo(HEADS);
    const started = wordsOf(now()).map((word) => word.box);
    const [first, second] = wordsOf(now()) as [TextItem, TextItem];
    const done = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: first.id, x: 0.5, y: 0.3, size: 0.04 }],
    });
    expect(done.ok).toBe(true);
    const placed = wordsOf(now()).map((word) => word.box);
    const edited = await w.bus.dispatch(
      'timeline.editText',
      { ...target, itemId: second.id, text: 'You all' },
      ui,
    );
    expect(edited.ok).toBe(true);
    const reworded = wordsOf(now()).map((word) => word.box);
    // The other words are where the AI put them; the re-worded one's box follows its new words, round its anchor.
    expect(reworded.filter((_, index) => index !== 1)).toEqual(placed.filter((_, index) => index !== 1));
    expect(reworded[1]!.width).toBeGreaterThan(placed[1]!.width);
    expect(centreOf(wordsOf(now())[1]!).x).toBeCloseTo(0.5, 9);
    const again = runPlacement(now(), w.template, { subjects });
    expect(wordsOf(again).map((word) => word.box)).toEqual(reworded);
    expect(spreadOf(wordsOf(now()).map((word) => centreOf(word).y))).toBeLessThanOrEqual(1e-9);
    // Undo the new words, then the placing: the run is back where the reel had it, unplaced.
    await w.bus.undo(target.projectId, ui);
    await w.bus.undo(target.projectId, ui);
    expect(wordsOf(now()).map((word) => word.box)).toEqual(started);
    expect(wordsOf(now()).every((word) => word.placedBy === undefined)).toBe(true);
  });
});

describe('video.done holds a made video until every text has a stated place', () => {
  it('held with a look and no place, in words that name the tool; passes once the group is placed', async () => {
    const { w, target, styles, now, drafted } = await styledVideo(HEADS);
    const designed = await w.call('timeline.designText', { ...target, name: 'Heavy white', looks: [HEAVY] });
    if (!designed.ok) throw new Error(designed.error.code);
    const style = styles.all.get(designed.value.styleId as string)!;
    expect(checkVideoDone({ ...drafted(), textStyle: style }).verdict).toEqual({
      verdict: 'retry',
      reason:
        "7 of the video's on-screen texts have no stated place or size yet: they sit where the reference had " +
        'them. Read timeline.textLook (each group, what is under it here), look at the text in your draft ' +
        'frames, then state every group’s place and size with timeline.placeText (asReel: true keeps the ' +
        'reference’s). Then render.draft again and call video.done.',
    });
    // No Style can be read at all (no style store): neither the look nor the place is held.
    expect(checkVideoDone(drafted()).verdict.verdict).toBe('pass');
    const placed = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: wordsOf(now())[0]!.id, asReel: true }],
    });
    expect(placed.ok).toBe(true);
    expect(checkVideoDone({ ...drafted(), textStyle: style }).verdict.verdict).toBe('pass');
  });

  it('never judges a place or a size: under a head, tiny, at the frame’s edge, it passes once stated', async () => {
    const { w, target, styles, now, drafted } = await styledVideo(HEADS);
    const designed = await w.call('timeline.designText', { ...target, name: 'Heavy white', looks: [HEAVY] });
    if (!designed.ok) throw new Error(designed.error.code);
    const style = styles.all.get(designed.value.styleId as string)!;
    await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: wordsOf(now())[0]!.id, x: 0.99, y: 0.45, align: 'left', size: 0.0073 }],
    });
    expect(checkVideoDone({ ...drafted(), textStyle: style }).verdict.verdict).toBe('pass');
  });

  it('a text the person placed counts as placed', async () => {
    const world = measuredWorld();
    const single = { ...world, template: { ...world.template, text: world.template.text.slice(0, 1) } };
    const { w, target, styles, now, drafted } = await styledVideo([], single);
    const designed = await w.call('timeline.designText', { ...target, name: 'Heavy white', looks: [HEAVY] });
    if (!designed.ok) throw new Error(designed.error.code);
    const style = styles.all.get(designed.value.styleId as string)!;
    expect(checkVideoDone({ ...drafted(), textStyle: style }).verdict.verdict).toBe('retry');
    const [only] = wordsOf(now());
    const mine = { x: 0.3, y: 0.2, width: 0.4, height: 0.05 };
    await w.bus.dispatch('timeline.moveText', { ...target, itemId: only!.id, box: mine }, ui);
    expect(checkVideoDone({ ...drafted(), textStyle: style }).verdict.verdict).toBe('pass');
    expect(wordsOf(now())[0]!.box).toEqual(mine);
  });
});
