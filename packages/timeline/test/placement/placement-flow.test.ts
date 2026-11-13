// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL end to end in the timeline package: the owner's case made up (a landscape reel's message beside its
 * speaker, a text item where its bubble sat since HFW1 retire, portrait clips whose speaker stands where the copied
 * box would land), through `timeline.assemble` with
 * a stand-in subject source; the fallbacks (retimed, recast, noRoom); and the solver again after new words, a
 * swap, and a person's move.
 */
import { describe, expect, it } from 'vitest';
import type { CommandOrigin, MediaRef, TextItem, Timeline } from '@taalcut/core';
import { fitBox } from '../../src/assembly/fit-layout';
import { intersects, toPixels, type Rect } from '../../src/assembly/placement/geometry';
import { runPlacement } from '../../src/assembly/placement/run-placement';
import { longestWordPx } from '../../src/assembly/placement/text-size';
import { placedClips } from '../../src/assembly/placement/subjects';
import { placedOver } from '../../src/commands/replace-after';
import { mediaRef } from '../../src/casting/result';
import { fakeSubjects, type FakeBox } from './fake-subjects';
import { assembled, BUBBLE, bubbleOf, CLIP_HEAD, itemsOf, madeWorld, REEL } from './reel-world';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const CANVAS = { width: 1080, height: 1920 };
const px = (box: FakeBox): Rect => toPixels(box, CANVAS);
const boxOf = (item: TextItem) => px(item.box);
const WHOLE: FakeBox = { x: 0.02, y: 0.05, width: 0.96, height: 0.9 };

describe('the owner’s case, made up', () => {
  it('before: the reel’s copied box lands on the clip’s head', () => {
    const copied = px(fitBox(BUBBLE.shape!, REEL, CANVAS));
    expect(intersects(copied, px(CLIP_HEAD))).toBe(true);
  });

  it('after: the bubble keeps the reel’s side of the head and covers it on no frame', async () => {
    const w = madeWorld(() => [CLIP_HEAD]);
    const timeline = await assembled(w);
    const bubble = bubbleOf(timeline);
    const box = boxOf(bubble);
    expect(intersects(box, px(CLIP_HEAD))).toBe(false);
    // Left of the head, as the reel had it: the words fit there at their size.
    expect(box.x + box.width).toBeLessThanOrEqual(px(CLIP_HEAD).x);
    expect(bubble.placement?.reason).toBe('asReel');
    // Every clip's range was made or joined before it was read.
    expect(w.subjects.ensured.length).toBeGreaterThan(0);
  });

  it('a track from before FRM1 (faces, no heads) still keeps the whole head clear', async () => {
    const subjects = fakeSubjects(() => [CLIP_HEAD], { measured: false });
    const w = madeWorld(() => [CLIP_HEAD]);
    const timeline = await assembled(w);
    const template = w.template;
    const run = await runPlacement(timeline, template, { subjects });
    expect(intersects(boxOf(bubbleOf(run.timeline)), px(CLIP_HEAD))).toBe(false);
  });

  it('tracks still being made don’t hold placement up: it reads what is stored, and says so', async () => {
    const stored = fakeSubjects(() => [CLIP_HEAD]);
    const slow = { ...stored, ensure: () => new Promise<never>(() => {}) };
    const w = madeWorld(() => [CLIP_HEAD]);
    const timeline = await assembled(w);
    const run = await runPlacement(timeline, w.template, { subjects: slow, ensureBudgetMs: 20 });
    expect(run.warnings).toContain('placement: some subject tracks are still being made');
    expect(intersects(boxOf(bubbleOf(run.timeline)), px(CLIP_HEAD))).toBe(false);
  });

  it('a text read off a narrow sign keeps whole words: never narrower than its longest word', async () => {
    const w = madeWorld(() => [CLIP_HEAD]);
    const timeline = await assembled(w);
    const template = {
      ...w.template,
      text: w.template.text.map((overlay) =>
        overlay.design ? overlay : { ...overlay, box: { ...overlay.box, width: 0.01 } },
      ),
    };
    const run = await runPlacement(timeline, template, { subjects: w.subjects });
    const text = itemsOf(run.timeline).find((item): item is TextItem => item.type === 'text')!;
    const word = longestWordPx(text.text, text.appearance.size, CANVAS);
    expect(text.box.width * CANVAS.width).toBeGreaterThanOrEqual(word - 1);
  });

  it('nobody on screen: the reel’s box, as the reel had it', async () => {
    const timeline = await assembled(madeWorld(() => []));
    const bubble = bubbleOf(timeline);
    expect(bubble.placement?.reason).toBe('asReel');
  });
});

describe('the fallbacks', () => {
  async function firstClip() {
    const w = madeWorld(() => []);
    const timeline = await assembled(w);
    const first = placedClips(timeline)[0]!;
    if (first.clip.media.kind !== 'video') throw new Error('a video');
    return { w, timeline, first, assetId: first.clip.media.assetId as string };
  }

  it('retimed: the clip’s in-point moves to a moment with room', async () => {
    const { w, timeline, first, assetId } = await firstClip();
    const from =
      (first.clip.sourceStart.value * first.clip.sourceStart.rate.den) / first.clip.sourceStart.rate.num;
    // A face fills the frame for the clip's own two seconds, and nowhere else.
    const subjects = fakeSubjects((asset, seconds) =>
      asset === assetId && seconds >= from - 0.5 && seconds < from + 2.5 ? [WHOLE] : [],
    );
    const run = await runPlacement(timeline, w.template, { subjects });
    const bubble = bubbleOf(run.timeline);
    expect(bubble.placement?.reason).toBe('retimed');
    const clip = placedClips(run.timeline)[0]!.clip;
    expect(clip.sourceStart.value).not.toBe(first.clip.sourceStart.value);
    expect(clip.syncPoint).toBeNull();
  });

  it('recast: the slot takes its next clip with room', async () => {
    const { w, timeline, assetId } = await firstClip();
    const subjects = fakeSubjects((asset) => (asset === assetId ? [WHOLE] : []));
    const media = async () =>
      new Map<string, MediaRef>(
        w.profiles.map((profile) => [profile.shotId ?? `asset:${profile.assetId}`, mediaRef(profile)]),
      );
    const run = await runPlacement(timeline, w.template, { subjects, media });
    const bubble = bubbleOf(run.timeline);
    expect(bubble.placement?.reason).toBe('recast');
    const clip = placedClips(run.timeline)[0]!.clip;
    expect(clip.media.kind === 'video' && clip.media.assetId).not.toBe(assetId);
    expect(run.timeline.cast?.slots[0]?.pick?.assetId).not.toBe(assetId);
  });

  // The head at the frame's left edge: the bubble finds room, but only off the reel's side (left) of it.
  const EDGE_HEAD: FakeBox = { x: 0.04, y: 0.2, width: 0.26, height: 0.17 };

  it('the reel’s side lost: the clip is retimed to a moment that keeps it', async () => {
    const { w, timeline, first, assetId } = await firstClip();
    const from =
      (first.clip.sourceStart.value * first.clip.sourceStart.rate.den) / first.clip.sourceStart.rate.num;
    const subjects = fakeSubjects((asset, seconds) =>
      asset === assetId && seconds >= from - 0.5 && seconds < from + 2.5 ? [EDGE_HEAD] : [CLIP_HEAD],
    );
    const stayed = await runPlacement(timeline, w.template, { subjects, ensureBudgetMs: 20 }, undefined);
    const bubbleId = bubbleOf(timeline).id;
    const run = stayed.report.find((entry) => entry.id === bubbleId)!;
    expect(run.side).toBe('left');
    expect(run.reason).toBe('retimed');
    expect(placedClips(stayed.timeline)[0]!.clip.sourceStart.value).not.toBe(first.clip.sourceStart.value);
    expect(stayed.warnings.some((warning) => warning.includes(bubbleId))).toBe(false);
  });

  it('the reel’s side lost everywhere: placed off it, and the run says so', async () => {
    const { w, timeline } = await firstClip();
    const subjects = fakeSubjects(() => [EDGE_HEAD]);
    const run = await runPlacement(timeline, w.template, { subjects });
    const entry = run.report.find((candidate) => candidate.id === bubbleOf(timeline).id)!;
    expect(entry.reason).not.toBe('noRoom');
    expect(entry.side).not.toBe('left');
    const id = bubbleOf(timeline).id;
    expect(run.warnings.some((warning) => warning.includes(id) && warning.includes('not left of it'))).toBe(
      true,
    );
    expect(intersects(boxOf(bubbleOf(run.timeline)), px(EDGE_HEAD))).toBe(false);
  });

  it('noRoom: with no room anywhere it says so, for QA to fail, and never pretends', async () => {
    const { w, timeline } = await firstClip();
    const subjects = fakeSubjects(() => [WHOLE]);
    const run = await runPlacement(timeline, w.template, { subjects });
    const bubble = bubbleOf(run.timeline);
    expect(bubble.placement?.reason).toBe('noRoom');
  });
});

describe('placed again after an edit', () => {
  it('new words: the bubble is sized and placed again, still clear of the head', async () => {
    const w = madeWorld(() => [CLIP_HEAD]);
    const timeline = await assembled(w);
    const bubble = bubbleOf(timeline);
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const text = 'A much longer made-up message that wraps onto more lines than before';
    const edited = await w.bus.dispatch('timeline.editText', { ...target, itemId: bubble.id, text }, ui);
    expect(edited.ok).toBe(true);
    const after = bubbleOf(w.store.docs.get(timeline.id)!);
    expect(after.text).toBe(text);
    expect(intersects(boxOf(after), px(CLIP_HEAD))).toBe(false);
    expect(boxOf(after).height).toBeGreaterThan(boxOf(bubble).height);
  });

  it('a swap: the bubble is placed again over the new clip’s people', async () => {
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
    expect(intersects(boxOf(after), px(elsewhere))).toBe(false);
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
