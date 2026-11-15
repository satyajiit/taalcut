// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1 through the pinned shell: the lines a text draws on, measured where Chrome drew them. The owner's make gave
 * "After 9 to 5" a box 70 % of the frame wide; at its size the sentence was wider than that, and it drew on two
 * lines. A text whose box follows its words (`breaks: 'written'`) draws on one line from its anchor at any size,
 * a line break in its words is its only break, and the frame's width is its only limit. A text from before, and one
 * given a width to wrap at, wraps at its box as it always did.
 */
import { join } from 'node:path';
import {
  err,
  FrameRate,
  newId,
  NotFoundError,
  timelineSchema,
  type TextItem,
  type Timeline,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureFrame } from '../../src/engine/capture-frame';
import { createStyleSource } from '../../src/style/resolve-style';
import { fakeWorld, type FakeWorld } from '../router/fixtures';
import { movingClip } from '../support/engine';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';

const media = await findTestMedia('text lines');
const shell = findTestShell('text lines');
const rate = FrameRate.of(30);
const WIDTH = 1080;
const TURN = 20;
/** The Maker's box: 70 % of the frame wide, a little under the middle. */
const BOX = { x: 0.15, y: 0.575, width: 0.7, height: 0.065 };
const SENTENCE = 'After 9 to 5';

type Case = Pick<TextItem, 'text' | 'box'> & {
  readonly name: string;
  readonly size: number;
  readonly align?: TextItem['appearance']['align'];
  readonly breaks?: TextItem['breaks'];
};

const CASES: readonly Case[] = [
  // What the owner saw: the box's width wrapped the sentence.
  { name: 'before', text: SENTENCE, box: BOX, size: 0.05 },
  { name: 'written', text: SENTENCE, box: BOX, size: 0.05, breaks: 'written' },
  // The reel's size, in a box far narrower than the words: the reel's own box, read off a condensed face.
  {
    name: 'narrow',
    text: SENTENCE,
    box: { x: 0.35, y: 0.5, width: 0.3, height: 0.05 },
    size: 0.025,
    breaks: 'written',
  },
  { name: 'break', text: 'After\n9 to 5', box: BOX, size: 0.05, breaks: 'written' },
  { name: 'left', text: SENTENCE, box: { ...BOX, x: 0.2 }, size: 0.03, align: 'left', breaks: 'written' },
  {
    name: 'right',
    text: SENTENCE,
    box: { ...BOX, x: 0.1 },
    size: 0.03,
    align: 'right',
    breaks: 'written',
  },
  // Wider than the frame at this size: the frame is the one limit.
  {
    name: 'huge',
    text: SENTENCE,
    box: { x: 0, y: 0.4, width: 1, height: 0.3 },
    size: 0.12,
    breaks: 'written',
  },
  { name: 'width', text: SENTENCE, box: BOX, size: 0.05, breaks: 'width' },
];

describe.skipIf(!media.binaries || !shell.path)(
  'TXT1: the lines a text draws on',
  { timeout: 360_000 },
  () => {
    let ctx: MediaContext;
    let work: Awaited<ReturnType<typeof tempDir>>;
    let world: FakeWorld;
    const drawn = new Map<
      string,
      { lines: number; box: { x: number; y: number; width: number; height: number } }
    >();

    beforeAll(async () => {
      ctx = mediaContext(media.binaries!);
      work = await tempDir('text-lines');
      world = await fakeWorld(join(work.dir, 'world'), { ctx, shell: shell.path! });
      const clip = newId<'Asset'>();
      const file = join(work.dir, 'moving.mp4');
      const frames = CASES.length * TURN;
      await movingClip(ctx, file, { frames, rate: '30', size: '1080x1920', silent: true });
      world.originals.set(clip, file);
      const made = makeTimeline({
        rate,
        items: [{ frames, assetId: clip, sourceStart: 0, mediaFrames: frames }],
        texts: CASES.map((entry, index) => ({
          start: index * TURN,
          frames: TURN,
          text: entry.text,
          reveal: 'none',
        })),
      });
      const as = (item: TextItem, entry: Case): TextItem => ({
        ...item,
        box: entry.box,
        appearance: { ...item.appearance, size: entry.size, align: entry.align ?? 'center' },
        ...(entry.breaks ? { breaks: entry.breaks } : {}),
      });
      const timeline: Timeline = timelineSchema.parse({
        ...made,
        tracks: made.tracks.map((track) =>
          track.kind !== 'text'
            ? track
            : {
                ...track,
                items: track.items.map((item, index) =>
                  item.type === 'text' ? as(item, CASES[index]!) : item,
                ),
              },
        ),
      });
      world.timelines.set(timeline.id, timeline);
      const styles = createStyleSource({
        styles: {
          get: async (styleId) => err(NotFoundError({ entity: 'style', id: styleId })),
          assetPath: async (sha256) => err(NotFoundError({ entity: 'styleAsset', id: sha256 })),
        },
      });
      for (const [index, entry] of CASES.entries()) {
        const shot = await captureFrame(
          { ...world.deps, styles },
          {
            projectId: timeline.projectId,
            timelineId: timeline.id,
            frame: index * TURN + TURN / 2,
            source: { kind: 'preview' },
            maxDimension: 1920,
          },
        );
        if (!shot.ok) throw new Error(`${entry.name}: ${shot.error.code} ${shot.error.detail ?? ''}`);
        const [text] = shot.value.textBoxes.filter((box) => box.kind === 'text');
        if (!text) throw new Error(`${entry.name}: no text in the frame`);
        drawn.set(entry.name, { lines: text.lines, box: text.box });
      }
    });
    afterAll(async () => work?.dispose());

    const of = (name: string) => drawn.get(name)!;
    const centre = (name: string) => of(name).box.x + of(name).box.width / 2;

    it('the owner’s box: the sentence broke in two before; with a box that follows the words it is one line', () => {
      expect(of('before').lines).toBe(2);
      expect(of('written').lines).toBe(1);
      // One line wider than the 70 % box, centred where the box is centred.
      expect(of('written').box.width).toBeGreaterThan(BOX.width * WIDTH);
      expect(centre('written')).toBeCloseTo((BOX.x + BOX.width / 2) * WIDTH, -1);
    });

    it('at the reel’s size too, in a box far narrower than the words: one line, centred on the box', () => {
      expect(of('narrow').lines).toBe(1);
      expect(of('narrow').box.width).toBeGreaterThan(0.3 * WIDTH);
      expect(centre('narrow')).toBeCloseTo(0.5 * WIDTH, -1);
    });

    it('a line break in the words gives exactly two lines; a stated width wraps as a box always did', () => {
      expect(of('break').lines).toBe(2);
      expect(of('width').lines).toBe(2);
      expect(of('width').box.width).toBeLessThanOrEqual(BOX.width * WIDTH + 2);
    });

    it('a left-aligned line starts at the box’s left edge, a right-aligned one ends at its right edge', () => {
      expect(of('left').lines).toBe(1);
      expect(of('left').box.x).toBeCloseTo(0.2 * WIDTH, -1);
      expect(of('right').lines).toBe(1);
      expect(of('right').box.x + of('right').box.width).toBeCloseTo(0.8 * WIDTH, -1);
    });

    it('a line wider than the frame at its size wraps at the frame’s width and stays inside the frame', () => {
      expect(of('huge').lines).toBeGreaterThan(1);
      expect(of('huge').box.x).toBeGreaterThanOrEqual(0);
      expect(of('huge').box.x + of('huge').box.width).toBeLessThanOrEqual(WIDTH);
    });
  },
);
