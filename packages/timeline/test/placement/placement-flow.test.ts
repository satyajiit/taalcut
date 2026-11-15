// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL and TXT1 end to end in the timeline package: the owner's case made up (a landscape reel's message beside
 * its speaker, a text item where its bubble sat since HFW1 retire, portrait clips whose speaker stands where the
 * copied box would land), through `timeline.assemble` with a stand-in subject source.
 *
 * TXT1 (the owner's rule: no code decides where text sits): a make and an edit lay the text out as the reel had it
 * (`runPlacement`), and what the solver finds reaches the AI as a candidate (`candidatePlaces`), tested here with the
 * people read as the tools read them (`spansFor`). Nothing retimes or recasts a clip for a text any more.
 */
import { describe, expect, it } from 'vitest';
import type { CommandOrigin, SubjectSource, Template, TextItem, Timeline } from '@taalcut/core';
import { fitBox } from '../../src/assembly/fit-layout';
import { intersects, toPixels, type Rect } from '../../src/assembly/placement/geometry';
import { candidatePlaces } from '../../src/assembly/placement/place-timeline';
import { runPlacement, spansFor } from '../../src/assembly/placement/run-placement';
import { fitWords } from '../../src/assembly/placement/text-size';
import { clipSourceRange, placedClips } from '../../src/assembly/placement/subjects';
import { placedOver } from '../../src/commands/replace-after';
import { fakeSubjects, type FakeBox } from './fake-subjects';
import { assembled, BUBBLE, bubbleOf, CLIP_HEAD, itemsOf, madeWorld, REEL } from './reel-world';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const CANVAS = { width: 1080, height: 1920 };
const px = (box: FakeBox): Rect => toPixels(box, CANVAS);
const boxOf = (item: TextItem) => px(item.box);
const WHOLE: FakeBox = { x: 0.02, y: 0.05, width: 0.96, height: 0.9 };

/** The solver's candidate for the bubble with these people, read as `timeline.textLook` reads them. */
async function candidateFor(
  timeline: Timeline,
  template: Template,
  subjects: SubjectSource,
  waitMs?: number,
) {
  const rate = timeline.canvas.rate;
  const warnings: string[] = [];
  const spans = await spansFor(
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
    warnings,
    waitMs === undefined ? {} : { ensureBudgetMs: waitMs },
  );
  const id = bubbleOf(timeline).id;
  const found = candidatePlaces({ timeline, template, subjects: spans }).find((entry) =>
    entry.items.some((item) => item.id === id),
  )!;
  const bubble = found.items.find((item): item is TextItem => item.id === id && item.type === 'text')!;
  return { found, bubble, warnings };
}

describe('the owner’s case, made up', () => {
  it('before: the reel’s copied box lands on the clip’s head', () => {
    const copied = px(fitBox(BUBBLE.shape!, REEL, CANVAS));
    expect(intersects(copied, px(CLIP_HEAD))).toBe(true);
  });

  it('a make starts the bubble where the reel had it, head or no head (TXT1): placing it is the AI’s', async () => {
    const w = madeWorld(() => [CLIP_HEAD]);
    const bubble = bubbleOf(await assembled(w));
    expect(intersects(boxOf(bubble), px(CLIP_HEAD))).toBe(true);
    expect(bubble.placement?.reason).toBe('asReel');
    expect(bubble.placedBy).toBeUndefined();
    // Every clip's range is still asked for, for the tools that say what is under a text.
    expect(w.subjects.ensured.length).toBeGreaterThan(0);
  });

  it('the solver’s candidate: the reel’s side of the head, on it on no frame; the bubble itself stays', async () => {
    const w = madeWorld(() => [CLIP_HEAD]);
    const timeline = await assembled(w);
    const { found, bubble } = await candidateFor(timeline, w.template, w.subjects);
    const box = boxOf(bubble);
    expect(intersects(box, px(CLIP_HEAD))).toBe(false);
    // Left of the head, as the reel had it: the words fit there at their size.
    expect(box.x + box.width).toBeLessThanOrEqual(px(CLIP_HEAD).x);
    expect(found.reason).toBe('asReel');
    // A candidate: the video's own bubble is where it was.
    expect(intersects(boxOf(bubbleOf(timeline)), px(CLIP_HEAD))).toBe(true);
  });

  it('a track from before FRM1 (faces, no heads): the candidate still keeps the whole head clear', async () => {
    const subjects = fakeSubjects(() => [CLIP_HEAD], { measured: false });
    const w = madeWorld(() => [CLIP_HEAD]);
    const { bubble } = await candidateFor(await assembled(w), w.template, subjects);
    expect(intersects(boxOf(bubble), px(CLIP_HEAD))).toBe(false);
  });

  it('tracks still being made don’t hold the read up: what is stored is read, and it says so', async () => {
    const stored = fakeSubjects(() => [CLIP_HEAD]);
    const slow = { ...stored, ensure: () => new Promise<never>(() => {}) };
    const w = madeWorld(() => [CLIP_HEAD]);
    const { bubble, warnings } = await candidateFor(await assembled(w), w.template, slow, 20);
    expect(warnings).toContain('placement: some subject tracks are still being made');
    expect(intersects(boxOf(bubble), px(CLIP_HEAD))).toBe(false);
  });

  // The head at the frame's left edge: the bubble finds room, but only off the reel's side (left) of it.
  const EDGE_HEAD: FakeBox = { x: 0.04, y: 0.2, width: 0.26, height: 0.17 };

  it('the reel’s side lost everywhere: the candidate is off it, clear of the head', async () => {
    const w = madeWorld(() => []);
    const { found, bubble } = await candidateFor(
      await assembled(w),
      w.template,
      fakeSubjects(() => [EDGE_HEAD]),
    );
    expect(found.reason).not.toBe('noRoom');
    expect(intersects(boxOf(bubble), px(EDGE_HEAD))).toBe(false);
  });

  it('no room anywhere: the candidate says so, and never pretends', async () => {
    const w = madeWorld(() => []);
    const { found } = await candidateFor(
      await assembled(w),
      w.template,
      fakeSubjects(() => [WHOLE]),
    );
    expect(found.reason).toBe('noRoom');
  });

  it('a text read off a narrow sign is one line: its box follows its words, not the sign’s width', async () => {
    const w = madeWorld(() => [CLIP_HEAD]);
    const timeline = await assembled(w);
    const template = {
      ...w.template,
      text: w.template.text.map((overlay) =>
        overlay.design ? overlay : { ...overlay, box: { ...overlay.box, width: 0.01 } },
      ),
    };
    const laid = runPlacement(timeline, template, { subjects: w.subjects });
    const text = itemsOf(laid).find((item): item is TextItem => item.type === 'text')!;
    const words = fitWords(text.text, text.appearance.size, CANVAS);
    expect(words.lines).toBe(1);
    expect(text.breaks).toBe('written');
    expect(text.box.width * CANVAS.width).toBeCloseTo(words.width, 0);
    expect(text.box.height * CANVAS.height).toBeCloseTo(words.height, 0);
  });

  it('nobody on screen: the reel’s box, as the reel had it', async () => {
    const timeline = await assembled(madeWorld(() => []));
    const bubble = bubbleOf(timeline);
    expect(bubble.placement?.reason).toBe('asReel');
  });
});

describe('laid out again after an edit', () => {
  it('new words: the bubble’s box follows them where the reel had it; no head moves it (TXT1)', async () => {
    const w = madeWorld(() => [CLIP_HEAD]);
    const timeline = await assembled(w);
    const bubble = bubbleOf(timeline);
    expect(bubble.breaks).toBe('written');
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const reword = async (text: string) => {
      const edited = await w.bus.dispatch('timeline.editText', { ...target, itemId: bubble.id, text }, ui);
      expect(edited.ok).toBe(true);
      const after = bubbleOf(w.store.docs.get(timeline.id)!);
      expect(after.text).toBe(text);
      return after;
    };
    // A longer line: still one line, wider round the same anchor, as tall as it was. The head is still under it.
    const longer = await reword('How was the first day there?');
    expect(fitWords(longer.text, longer.appearance.size, CANVAS).lines).toBe(1);
    expect(boxOf(longer).width).toBeGreaterThan(boxOf(bubble).width);
    expect(longer.box.height).toBeCloseTo(bubble.box.height, 3);
    expect(longer.box.y + longer.box.height / 2).toBeCloseTo(bubble.box.y + bubble.box.height / 2, 3);
    expect(longer.box.x + longer.box.width / 2).toBeCloseTo(bubble.box.x + bubble.box.width / 2, 3);
    expect(longer.placement?.reason).toBe('asReel');
    // A line wider than the frame at its size: the frame is the one thing that breaks it, at the frame's width.
    const text = 'A much longer made-up message that is wider than the frame at the size the reel had';
    const after = await reword(text);
    const words = fitWords(text, after.appearance.size, CANVAS);
    expect(words.widerThanFrame).toBe(true);
    expect(words.lines).toBeGreaterThan(1);
    expect(after.box).toMatchObject({ x: 0, width: 1 });
    expect(boxOf(after).height).toBeGreaterThan(boxOf(bubble).height);
    expect(after.box.y + after.box.height / 2).toBeCloseTo(bubble.box.y + bubble.box.height / 2, 3);
    expect(after.breaks).toBe('written');
    expect(after.placement?.reason).toBe('asReel');
  });

  it('a swap: the bubble stays where it is, and the new clip’s track is asked for (TXT1)', async () => {
    const elsewhere: FakeBox = { x: 0.1, y: 0.2, width: 0.3, height: 0.18 };
    let swapped = '';
    const w = madeWorld((asset) => (asset === swapped ? [elsewhere] : [CLIP_HEAD]));
    const timeline = await assembled(w);
    const first = placedClips(timeline)[0]!;
    const alternate = timeline.cast!.slots[0]!.alternates[0]!;
    swapped = alternate.assetId;
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const done = await w.bus.dispatch(
      'timeline.swapClip',
      {
        ...target,
        clipId: first.clip.id,
        media: { assetId: alternate.assetId, shotId: alternate.shotId },
        from: 'alternate',
      },
      ui,
    );
    expect(done.ok).toBe(true);
    const after = bubbleOf(w.store.docs.get(timeline.id)!);
    expect(after.box).toEqual(bubbleOf(timeline).box);
    expect(w.subjects.ensured.map((range) => range.assetId)).toContain(alternate.assetId);
  });

  it('a clip brought in with no overlay over it still has its track asked for (applyCast, a trim)', async () => {
    const w = madeWorld(() => []);
    const timeline = await assembled(w);
    const slot = timeline.cast!.slots.at(-1)!;
    expect(placedOver(timeline, [slot.clipId!]).size).toBe(0);
    const alternate = slot.alternates[0]!;
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const before = w.subjects.ensured.length;
    const cast = await w.bus.dispatch(
      'timeline.applyCast',
      { ...target, picks: [{ slotId: slot.slotId, pick: alternate }] },
      ui,
    );
    expect(cast.ok).toBe(true);
    expect(w.subjects.ensured.slice(before).map((range) => range.assetId)).toContain(alternate.assetId);
    const after = w.store.docs.get(timeline.id)!;
    const clip = placedClips(after).at(-1)!.clip;
    const asked = w.subjects.ensured.length;
    const trimmed = await w.bus.dispatch(
      'timeline.trimClip',
      { ...target, clipId: clip.id, edge: 'start', by: { value: 3, rate: after.canvas.rate } },
      ui,
    );
    expect(trimmed.ok).toBe(true);
    expect(w.subjects.ensured.length).toBeGreaterThan(asked);
  });

  it('a text the person moved keeps its place: its record goes', async () => {
    const w = madeWorld(() => []);
    const timeline = await assembled(w);
    const text = itemsOf(timeline).find((item): item is TextItem => item.type === 'text')!;
    expect(text.placement?.reason).toBe('asReel');
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const box = { x: 0.2, y: 0.5, width: 0.5, height: 0.05 };
    await w.bus.dispatch('timeline.moveText', { ...target, itemId: text.id, box }, ui);
    const moved = itemsOf(w.store.docs.get(timeline.id) as Timeline).find(
      (item) => item.id === text.id,
    ) as TextItem;
    expect(moved.placement).toBeUndefined();
    expect(moved.box).toEqual(box);
  });
});
