// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V16 Done-when (apply part): "A style applies to 20 projects" in one command, undone in one step, all or
 * nothing on the staging store (writes land only when the bus records the step).
 */
import {
  BATCH_COMMANDS,
  CAPTION_PRESETS,
  TIMELINE_COMMANDS,
  type CaptionTrack,
  type Timeline,
  type TimelineStore,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { agentOrigin, commandWorld, ui } from '../fixtures/command-world';
import { BRAND_CAPTIONS, makeStyle, memoryStyles, withCaptions } from '../fixtures/styles';
import { buildTimeline } from '../fixtures/timeline';

type World = ReturnType<typeof commandWorld>;

/** `count` videos, each in its own project, with captions unless `bare` names its index. */
function videos(count: number, bare: readonly number[] = []): Timeline[] {
  return Array.from({ length: count }, (_, index) => {
    const { timeline } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    return bare.includes(index) ? timeline : withCaptions(timeline);
  });
}

const itemsOf = (timelines: readonly Timeline[]) =>
  timelines.map((timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id }));

const captionsOf = (world: World, timeline: Timeline): CaptionTrack | null => world.doc(timeline.id).captions;

/** The world's staging store, except that reading `trigger` lets another edit of `victim` commit first. */
function racing(target: () => TimelineStore, raced: () => void, trigger: string): TimelineStore {
  return {
    create: (timeline, context) => target().create(timeline, context),
    put: (timeline, revision, context) => target().put(timeline, revision, context),
    get: async (timelineId) => {
      if (timelineId === trigger) raced();
      return target().get(timelineId);
    },
    listByProject: (projectId) => target().listByProject(projectId),
    remove: (timelineId, context) => target().remove(timelineId, context),
  };
}

describe('batch.applyStyle', () => {
  it('puts one Style on 20 projects in one command, and one undo takes it off all 20', async () => {
    const style = makeStyle(BRAND_CAPTIONS);
    const world = commandWorld({ styles: memoryStyles([style]) });
    const timelines = videos(20);
    await world.seed(...timelines);

    const done = await world.dispatch(BATCH_COMMANDS.applyStyle, {
      items: itemsOf(timelines),
      apply: { kind: 'style', styleId: style.id },
    });
    expect(done.ok && done.value).toMatchObject({ applied: timelines.map((timeline) => timeline.id), skipped: [] });
    for (const timeline of timelines) {
      const doc = world.doc(timeline.id);
      expect(doc.styleId).toBe(style.id);
      expect(doc.captions?.style).toEqual(BRAND_CAPTIONS);
      expect(doc.captions?.styleSource).toBe('preset');
      expect(doc.captions?.cues).toEqual(timeline.captions?.cues);
      expect(doc.revision).toBe(2);
    }
    // App-wide history: the batch is not on any one project's stack.
    expect(await world.bus.history(null)).toMatchObject({ value: { undo: BATCH_COMMANDS.applyStyle } });
    expect(await world.bus.history(timelines[0]?.projectId ?? null)).toMatchObject({ value: { undo: null } });

    expect((await world.bus.undo(null, ui)).ok).toBe(true);
    for (const timeline of timelines) {
      const doc = world.doc(timeline.id);
      expect(doc.styleId).toBeNull();
      expect(captionsOf(world, timeline)).toEqual(timeline.captions);
      expect(doc.revision).toBe(3);
    }

    expect((await world.bus.redo(null, ui)).ok).toBe(true);
    for (const timeline of timelines) expect(world.doc(timeline.id).styleId).toBe(style.id);
  });

  it('keeps a change made after the batch when the batch is undone', async () => {
    const style = makeStyle(BRAND_CAPTIONS);
    const other = makeStyle(null, 'Other');
    const world = commandWorld({ styles: memoryStyles([style, other]) });
    const timelines = videos(5);
    await world.seed(...timelines);
    await world.dispatch(BATCH_COMMANDS.applyStyle, {
      items: itemsOf(timelines),
      apply: { kind: 'style', styleId: style.id },
    });
    const changed = timelines[2] as Timeline;
    const later = await world.dispatch(TIMELINE_COMMANDS.setStyle, {
      projectId: changed.projectId,
      timelineId: changed.id,
      styleId: other.id,
    });
    expect(later.ok).toBe(true);

    expect((await world.bus.undo(null, ui)).ok).toBe(true);
    expect(world.doc(changed.id).styleId).toBe(other.id);
    expect(world.doc(changed.id).captions?.style).toEqual(BRAND_CAPTIONS);
    for (const timeline of timelines.filter((candidate) => candidate !== changed)) {
      expect(world.doc(timeline.id).styleId).toBeNull();
      expect(captionsOf(world, timeline)).toEqual(timeline.captions);
    }
  });

  it('restoreStyles lists the videos changed since and restores the rest', async () => {
    const world = commandWorld();
    const timelines = videos(3);
    await world.seed(...timelines);
    const [first, second, gone] = timelines as [Timeline, Timeline, Timeline];
    const prior = { styleId: null, captions: null };
    const restored = await world.dispatch(
      BATCH_COMMANDS.restoreStyles,
      {
        items: [
          { ...itemsOf([first])[0], ...prior, revision: 1 },
          { ...itemsOf([second])[0], ...prior, revision: 7 },
          { ...itemsOf([gone])[0], projectId: first.projectId, ...prior, revision: 1 },
        ],
      },
      agentOrigin,
    );
    expect(restored.ok && restored.value).toMatchObject({
      applied: [first.id],
      skipped: [
        { timelineId: second.id, reason: 'changedSince' },
        { timelineId: gone.id, reason: 'changedSince' },
      ],
    });
    expect(world.doc(first.id).captions).toBeNull();
    expect(world.doc(second.id).captions).toEqual(second.captions);
  });

  it('a revision race on one video leaves all 20 as they were', async () => {
    const style = makeStyle(BRAND_CAPTIONS);
    const timelines = videos(20);
    const victim = timelines[4] as Timeline;
    const trigger = timelines[19] as Timeline;
    const holder: { world?: World } = {};
    const target = (): TimelineStore => {
      if (!holder.world) throw new Error('The world is not made yet');
      return holder.world.store;
    };
    const raced = () => {
      const doc = holder.world?.memory.docs.get(victim.id);
      if (doc)
        holder.world?.memory.docs.set(victim.id, {
          ...doc,
          name: 'Renamed meanwhile',
          revision: doc.revision + 1,
        });
    };
    const world = commandWorld({ styles: memoryStyles([style]), store: racing(target, raced, trigger.id) });
    holder.world = world;
    await world.seed(...timelines);

    const done = await world.dispatch(BATCH_COMMANDS.applyStyle, {
      items: itemsOf(timelines),
      apply: { kind: 'style', styleId: style.id },
    });
    expect(!done.ok && done.error.code).toBe('core.conflict');
    for (const timeline of timelines) {
      expect(world.doc(timeline.id).styleId).toBeNull();
      expect(captionsOf(world, timeline)).toEqual(timeline.captions);
    }
    expect(world.doc(victim.id).name).toBe('Renamed meanwhile');
    expect(await world.bus.history(null)).toMatchObject({ value: { undo: null } });
  });

  it('refuses a missing video, a video named twice and an unknown Style, changing nothing', async () => {
    const style = makeStyle(BRAND_CAPTIONS);
    const world = commandWorld({ styles: memoryStyles([style]) });
    const timelines = videos(4);
    await world.seed(...timelines);
    const items = itemsOf(timelines);
    const apply = { kind: 'style', styleId: style.id };

    const elsewhere = { ...items[3], projectId: timelines[0]?.projectId };
    const missing = await world.dispatch(BATCH_COMMANDS.applyStyle, {
      items: [...items.slice(0, 3), elsewhere],
      apply,
    });
    expect(!missing.ok && missing.error.code).toBe('timeline.not_found');
    const twice = await world.dispatch(BATCH_COMMANDS.applyStyle, { items: [...items, items[0]], apply });
    expect(!twice.ok && twice.error.code).toBe('core.validation');
    const unknown = await world.dispatch(BATCH_COMMANDS.applyStyle, {
      items,
      apply: { kind: 'style', styleId: makeStyle(null).id },
    });
    expect(!unknown.ok && unknown.error.code).toBe('timeline.style_not_found');
    for (const timeline of timelines) expect(world.doc(timeline.id)).toEqual(timeline);
  });

  it('puts a caption preset on the videos with captions and lists the others', async () => {
    // No Style store: a caption preset needs none.
    const world = commandWorld();
    const timelines = videos(3, [1]);
    await world.seed(...timelines);
    const [first, bare, third] = timelines as [Timeline, Timeline, Timeline];

    const done = await world.dispatch(BATCH_COMMANDS.applyStyle, {
      items: itemsOf(timelines),
      apply: { kind: 'captionPreset', presetId: 'bold' },
    });
    expect(done.ok && done.value).toMatchObject({
      applied: [first.id, third.id],
      skipped: [{ timelineId: bare.id, reason: 'noCaptions' }],
    });
    expect(world.doc(first.id).captions?.style).toEqual(CAPTION_PRESETS.bold);
    expect(world.doc(third.id).styleId).toBeNull();
    expect(world.doc(bare.id)).toEqual(bare);

    expect((await world.bus.undo(null, ui)).ok).toBe(true);
    expect(captionsOf(world, first)).toEqual(first.captions);
    expect(captionsOf(world, third)).toEqual(third.captions);
  });

  it('writes nothing and leaves nothing to undo when every video already has the look', async () => {
    const world = commandWorld();
    const timelines = videos(2);
    await world.seed(...timelines);
    const done = await world.dispatch(BATCH_COMMANDS.applyStyle, {
      items: itemsOf(timelines),
      apply: { kind: 'captionPreset', presetId: 'minimal' },
    });
    expect(done.ok && done.value).toMatchObject({ applied: timelines.map((timeline) => timeline.id), skipped: [] });
    for (const timeline of timelines) expect(world.doc(timeline.id).revision).toBe(1);
    expect(await world.bus.history(null)).toMatchObject({ value: { undo: null } });
  });

  it('a Style batch needs the Style store', async () => {
    const world = commandWorld();
    const timelines = videos(1);
    await world.seed(...timelines);
    const done = await world.dispatch(BATCH_COMMANDS.applyStyle, {
      items: itemsOf(timelines),
      apply: { kind: 'style', styleId: makeStyle(null).id },
    });
    expect(!done.ok && done.error.code).toBe('core.not_implemented');
  });
});
