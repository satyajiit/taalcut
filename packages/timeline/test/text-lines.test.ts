// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: a text draws on one line unless a break is stated. The owner's make, made up: two short sentences shown in
 * turn at one place ("After 9 to 5", "I come alive!"). The Maker gave both one box 70 % of the frame wide with
 * `timeline.moveText`, the sentences were wider than that at their size, and each broke in two.
 *
 * The box follows the words: at the reel's size and at twice it a sentence is one line; a line break in the words
 * or a width stated to `timeline.placeText` is what breaks it; and the frame is the one other limit (a line wider
 * than the frame wraps at the frame's width, and the facts say so).
 */
import { describe, expect, it } from 'vitest';
import type { CommandOrigin, TextItem } from '@taalcut/core';
import { fitWords } from '../src/assembly/placement/text-size';
import { memoryTemplateReader } from '../src/service/templates';
import { fitOf } from '../src/styles/text-box';
import { editTools } from '../src/tools/edit-tools';
import { memoryStyles } from './fixtures/text-design';
import { CANVAS, centreOf, madeVideo, textWorld, wordsOf } from './placement/lyric-world';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const SENTENCES = ['After 9 to 5', 'I come alive!'] as const;
const TURN = 30;
/** The Maker's box: 70 % of the frame wide, a little under the middle. */
const BOX = { x: 0.15, y: 0.575, width: 0.7, height: 0.065 };

/**
 * The reel: both sentences centred at 60 % of the height, each on its one line. The reel's own box is narrow (its
 * face was a condensed one): 30 % of the frame, far less than the words take in the made video's face.
 */
async function made(size: number) {
  const world = textWorld(
    SENTENCES.map((text, index) => ({
      text,
      start: index * TURN,
      frames: TURN,
      box: { x: 0.35, y: 0.6 - size, width: 0.3, height: 2 * size },
      size,
    })),
  );
  const styles = memoryStyles();
  const video = await madeVideo(world, [], { styles, templates: memoryTemplateReader([world.template]) });
  const target = { projectId: video.timeline.projectId, timelineId: video.timeline.id };
  const now = () => video.w.store.docs.get(video.timeline.id)!;
  return { ...video, target, now };
}

const linesOf = (texts: readonly TextItem[]) => texts.map((text) => fitOf(text, CANVAS).lines);
type Group = Record<string, unknown>;
const groupsOf = (value: Record<string, unknown>) => value.groups as Group[];

describe('a sentence is one line, at any size', () => {
  it('at the reel’s size: one line each, though the reel’s own box was far narrower than the words', async () => {
    const { now } = await made(0.02);
    const texts = wordsOf(now());
    expect(texts.map((text) => text.text)).toEqual([...SENTENCES]);
    expect(texts.every((text) => text.breaks === 'written')).toBe(true);
    expect(linesOf(texts)).toEqual([1, 1]);
    for (const text of texts) {
      // The box is the words' own, wider than the reel's 30 %, round the reel's centre.
      const words = fitWords(text.text, 0.02, CANVAS);
      expect(text.box.width).toBeCloseTo(words.width / CANVAS.width, 3);
      expect(text.box.width).toBeGreaterThan(0.3);
      expect(centreOf(text).x).toBeCloseTo(0.5, 3);
    }
  });

  it('at twice the reel’s size: still one line each, and the answer says so', async () => {
    const { w, target, now } = await made(0.02);
    const [first] = wordsOf(now());
    const done = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: first!.id, size: 0.04 }],
    });
    if (!done.ok) throw new Error(`${done.error.code} ${done.error.detail ?? ''}`);
    const texts = wordsOf(now());
    expect(texts.every((text) => text.appearance.size === 0.04 && text.breaks === 'written')).toBe(true);
    expect(linesOf(texts)).toEqual([1, 1]);
    expect(texts[0]!.box.width).toBeCloseTo(fitWords(SENTENCES[0], 0.04, CANVAS).width / CANVAS.width, 9);
    expect(groupsOf(done.value)).toEqual([
      expect.objectContaining({ texts: 2, capPx: 77, lines: [1, 1], wrapAt: null, widerThanFrame: false }),
    ]);
  });

  it('a line wider than the frame at its size wraps at the frame’s width: the frame-edge rule, said', async () => {
    const { w, target, now } = await made(0.02);
    const [first] = wordsOf(now());
    const done = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: first!.id, x: 0.3, size: 0.09 }],
    });
    if (!done.ok) throw new Error(`${done.error.code} ${done.error.detail ?? ''}`);
    const texts = wordsOf(now());
    expect(fitWords(SENTENCES[0], 0.09, CANVAS).widerThanFrame).toBe(true);
    // The frame's width, whatever anchor was stated; no narrower width breaks it.
    for (const text of texts) expect(text.box).toMatchObject({ x: 0, width: 1 });
    expect(texts.every((text) => text.breaks === 'written')).toBe(true);
    const [group] = groupsOf(done.value);
    expect(group).toMatchObject({ widerThanFrame: true, atFrameEdge: true, wrapAt: null });
    expect((group!.lines as number[]).every((lines) => lines > 1)).toBe(true);
  });
});

describe('a stated break is what breaks a line', () => {
  it('a line break in the words: exactly two lines, the box two lines tall and as wide as the wider one', async () => {
    const { w, target, now } = await made(0.02);
    const [first] = wordsOf(now());
    const edited = await w.bus.dispatch(
      'timeline.editText',
      { ...target, itemId: first!.id, text: 'After\n9 to 5' },
      ui,
    );
    expect(edited.ok).toBe(true);
    const [broken, other] = wordsOf(now());
    expect(broken!.text).toBe('After\n9 to 5');
    expect(linesOf([broken!, other!])).toEqual([2, 1]);
    const read = await w.call('timeline.textLook', target);
    if (!read.ok) throw new Error(read.error.code);
    expect(groupsOf(read.value)[0]).toMatchObject({ lines: [2, 1], wrapAt: null, widerThanFrame: false });
    // At twice the size too: the written break is the only one.
    const placed = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: first!.id, size: 0.04 }],
    });
    if (!placed.ok) throw new Error(placed.error.code);
    expect(groupsOf(placed.value)[0]).toMatchObject({ lines: [2, 1] });
    const tall = wordsOf(now())[0]!;
    expect(tall.box.height).toBeCloseTo(fitWords(tall.text, 0.04, CANVAS).height / CANVAS.height, 9);
    expect(tall.box.width).toBeCloseTo(fitWords('9 to 5', 0.04, CANVAS).width / CANVAS.width, 9);
  });

  it('a width stated to timeline.placeText wraps there; a later place without one is one line again', async () => {
    const { w, target, now } = await made(0.02);
    const [first] = wordsOf(now());
    const wrapped = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: first!.id, size: 0.04, width: 0.4 }],
    });
    if (!wrapped.ok) throw new Error(`${wrapped.error.code} ${wrapped.error.detail ?? ''}`);
    const texts = wordsOf(now());
    expect(texts.every((text) => text.breaks === 'width')).toBe(true);
    for (const text of texts) expect(text.box.width).toBeCloseTo(0.4, 9);
    expect(groupsOf(wrapped.value)[0]).toMatchObject({ lines: [2, 2], wrapAt: 0.4, widerThanFrame: false });
    const again = await w.call('timeline.placeText', { ...target, groups: [{ itemId: first!.id, y: 0.3 }] });
    if (!again.ok) throw new Error(again.error.code);
    expect(wordsOf(now()).every((text) => text.breaks === 'written')).toBe(true);
    expect(groupsOf(again.value)[0]).toMatchObject({ y: 0.3, lines: [1, 1], wrapAt: null });
  });
});

describe('the owner’s make: one box for both sentences, with timeline.moveText', () => {
  it('the AI’s box says where they sit, not where they wrap: one line each, anchored at the box', async () => {
    const { w, target, now } = await made(0.04);
    const ids = wordsOf(now()).map((text) => text.id);
    // Both sentences are wider than the box at this size: this is what broke them in two.
    for (const text of SENTENCES)
      expect(fitWords(text, 0.04, CANVAS).width / CANVAS.width).toBeGreaterThan(BOX.width);
    const moved = await w.call('timeline.moveText', { ...target, itemIds: ids, box: BOX });
    if (!moved.ok) throw new Error(`${moved.error.code} ${moved.error.detail ?? ''}`);
    const texts = wordsOf(now());
    expect(linesOf(texts)).toEqual([1, 1]);
    for (const text of texts) {
      expect(text.breaks).toBe('written');
      expect(text.placedBy).toBe('editor');
      // Centred texts: anchored at the box's centre and middle, their own width.
      expect(centreOf(text).x).toBeCloseTo(BOX.x + BOX.width / 2, 9);
      expect(centreOf(text).y).toBeCloseTo(BOX.y + BOX.height / 2, 9);
      expect(text.box.width).toBeCloseTo(fitWords(text.text, 0.04, CANVAS).width / CANVAS.width, 9);
      expect(text.box.width).toBeGreaterThan(BOX.width);
    }
    const read = await w.call('timeline.textLook', target);
    if (!read.ok) throw new Error(read.error.code);
    expect(groupsOf(read.value)[0]).toMatchObject({ lines: [1, 1], wrapAt: null, placedBy: 'ai' });
  });

  it('a left-aligned text starts at the box’s left edge; new words keep that edge', async () => {
    const { w, target, now } = await made(0.04);
    const [first] = wordsOf(now());
    const flush = await w.call('timeline.placeText', {
      ...target,
      groups: [{ itemId: first!.id, align: 'left', x: 0.1 }],
    });
    expect(flush.ok).toBe(true);
    const moved = await w.call('timeline.moveText', { ...target, itemId: first!.id, box: BOX });
    expect(moved.ok).toBe(true);
    expect(wordsOf(now())[0]!.box.x).toBeCloseTo(BOX.x, 9);
    const edited = await w.call('timeline.editText', { ...target, itemId: first!.id, text: 'After five' });
    if (!edited.ok) throw new Error(`${edited.error.code} ${edited.error.detail ?? ''}`);
    const reworded = wordsOf(now())[0]!;
    expect(reworded.box.x).toBeCloseTo(BOX.x, 9);
    expect(reworded.box.width).toBeCloseTo(fitWords('After five', 0.04, CANVAS).width / CANVAS.width, 9);
    expect(linesOf([reworded])).toEqual([1]);
  });

  it('the person’s box is theirs as given: a box they made narrower states where the words wrap', async () => {
    const { w, target, now } = await made(0.04);
    const [first] = wordsOf(now());
    const narrow = { x: 0.3, y: 0.5, width: 0.4, height: 0.1 };
    const moved = await w.bus.dispatch(
      'timeline.moveText',
      { ...target, itemId: first!.id, box: narrow },
      ui,
    );
    expect(moved.ok).toBe(true);
    const mine = wordsOf(now())[0]!;
    expect(mine.box).toEqual(narrow);
    expect(mine.placedBy).toBe('person');
    expect(mine.breaks).toBe('width');
    expect(linesOf([mine])).toEqual([2]);
    // Dragged somewhere else at the same width: nothing about its lines changes.
    const dragged = { ...narrow, y: 0.2 };
    await w.bus.dispatch('timeline.moveText', { ...target, itemId: first!.id, box: dragged }, ui);
    expect(wordsOf(now())[0]!).toMatchObject({ box: dragged, breaks: 'width' });
  });
});

describe('the tools say it', () => {
  it('timeline.moveText and timeline.editText are 1.1.0, and each says a box never wraps a text', () => {
    const tools = new Map(editTools().map((tool) => [tool.name, tool]));
    const move = tools.get('timeline.moveText')!;
    const edit = tools.get('timeline.editText')!;
    expect([move.version, edit.version]).toEqual(['1.1.0', '1.1.0']);
    expect(move.description).toContain('never where it wraps');
    expect(edit.description).toContain('A line break in the wording is the only thing that breaks a line');
    // The other edit tools are as they were.
    expect(tools.get('timeline.trimClip')!.version).toBe('1.0.0');
  });
});
