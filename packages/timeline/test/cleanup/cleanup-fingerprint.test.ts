// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Round P3-3 for timeline.applyCleanup: the plan's `clipsFingerprint` lets a plan made before an unrelated edit
 * apply and refuses one whose clips changed; a plan stored without one keeps the revision rule; and a redo is
 * never stale, also after a restart (a new bus on the same audit log), because the bus says it is a redo.
 */
import {
  CLEANUP_SETTING,
  FrameRates,
  newId,
  RationalTime,
  type CleanupPlan,
  type Clip,
  type TextItem,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { clipsFingerprint } from '../../src/cleanup/clips-fingerprint';
import { planCleanup } from '../../src/cleanup/plan-cleanup';
import { videoItems } from '../../src/model/sequence';
import { commandWorld, ui } from '../fixtures/command-world';
import { talkingHead, talkingTimeline } from '../fixtures/speech';

function textItem(rate: Timeline['canvas']['rate']): TextItem {
  return {
    type: 'text',
    id: newId<'TimelineItem'>(),
    start: RationalTime.of(0, rate),
    duration: RationalTime.of(30, rate),
    text: 'Hello',
    role: 'title',
    slotId: null,
    overlayId: null,
    box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
    appearance: { size: 0.05, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'title',
    reveal: 'none',
    language: 'en',
    origin: 'user',
  };
}

/** A talking head with one title, its cleanup plan and a command world holding it. */
async function planned() {
  const head = talkingHead(newId<'Asset'>(), { seed: 3, words: 20, fillerEvery: 3, pauseEvery: 4 });
  const base = talkingTimeline(head, FrameRates.fps30, FrameRates.fps30);
  const title = textItem(base.canvas.rate);
  const timeline: Timeline = {
    ...base,
    tracks: base.tracks.map((track) => (track.kind === 'text' ? { ...track, items: [title] } : track)),
  };
  const plan = planCleanup(
    timeline,
    new Map([[head.analysis.assetId, head.analysis]]),
    CLEANUP_SETTING.defaultValue,
    () => newId<'TimelineItem'>(),
  );
  if (!plan.ok) throw new Error(plan.error.code);
  const world = commandWorld();
  await world.seed(timeline);
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  const clip = videoItems(timeline)[0] as Clip;
  return { timeline, plan: plan.value, world, target, title, clip };
}

const clipIds = (plan: CleanupPlan) => plan.clips.map((entry) => entry.clipId);

describe('clipsFingerprint', () => {
  it('is in the plan, lowercase hex, and the same for the clips as they are', async () => {
    const { timeline, plan } = await planned();
    expect(plan.clipsFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(clipsFingerprint(timeline, clipIds(plan))).toBe(plan.clipsFingerprint);
  });

  it("doesn't change with a caption or text edit, changes with a trim, and is null without the clip", async () => {
    const { timeline, plan, title } = await planned();
    const ids = clipIds(plan);
    const captioned: Timeline = {
      ...timeline,
      revision: timeline.revision + 1,
      tracks: timeline.tracks.map((track) =>
        track.kind === 'text' ? { ...track, items: [{ ...title, text: 'Hi there' }] } : track,
      ),
    };
    expect(clipsFingerprint(captioned, ids)).toBe(plan.clipsFingerprint);
    const trimmed: Timeline = {
      ...timeline,
      tracks: timeline.tracks.map((track) =>
        track.kind !== 'video'
          ? track
          : {
              ...track,
              items: track.items.map((item) =>
                item.type === 'clip'
                  ? { ...item, duration: { ...item.duration, value: item.duration.value - 10 } }
                  : item,
              ),
            },
      ),
    };
    expect(clipsFingerprint(trimmed, ids)).not.toBe(plan.clipsFingerprint);
    expect(clipsFingerprint(timeline, [...ids, newId<'TimelineItem'>()])).toBeNull();
  });
});

describe('timeline.applyCleanup on another revision', () => {
  it('applies a plan made before an unrelated edit', async () => {
    const { plan, world, target, title, clip } = await planned();
    expect(
      (await world.dispatch('timeline.editText', { ...target, itemId: title.id, text: 'Hi there' })).ok,
    ).toBe(true);
    const done = await world.dispatch('timeline.applyCleanup', { ...target, plan });
    expect(done.ok).toBe(true);
    const ids = videoItems(world.doc(target.timelineId)).map((item) => item.id);
    expect(ids).toEqual([clip.id, ...(plan.clips[0]?.newIds ?? [])]);
  });

  it('refuses a plan whose clip was trimmed since', async () => {
    const { plan, world, target, clip } = await planned();
    const trim = { ...target, clipId: clip.id, edge: 'end', by: RationalTime.of(-10, clip.duration.rate) };
    expect((await world.dispatch('timeline.trimClip', trim)).ok).toBe(true);
    const stale = await world.dispatch('timeline.applyCleanup', { ...target, plan });
    expect(!stale.ok && stale.error.code).toBe('timeline.cleanup_stale');
  });

  it('keeps the revision rule for a plan stored without a fingerprint', async () => {
    const { plan, world, target, title } = await planned();
    const { clipsFingerprint: _dropped, ...stored } = plan;
    expect(
      (await world.dispatch('timeline.editText', { ...target, itemId: title.id, text: 'Hi there' })).ok,
    ).toBe(true);
    const stale = await world.dispatch('timeline.applyCleanup', { ...target, plan: stored });
    expect(!stale.ok && stale.error.code).toBe('timeline.cleanup_stale');
  });
});

describe('timeline.applyCleanup redo after a restart', () => {
  it.each([
    ['with', (plan: CleanupPlan) => plan],
    ['without', ({ clipsFingerprint: _dropped, ...stored }: CleanupPlan) => stored],
  ])('applies again on a new bus over the same audit log, %s a fingerprint', async (_label, stored) => {
    const { plan, world, target } = await planned();
    expect((await world.dispatch('timeline.applyCleanup', { ...target, plan: stored(plan) })).ok).toBe(true);
    const cleaned = world.doc(target.timelineId);
    expect((await world.bus.undo(target.projectId, ui)).ok).toBe(true);
    const restarted = commandWorld({}, world.disk);
    const redone = await restarted.bus.redo(target.projectId, ui);
    expect(redone.ok).toBe(true);
    const after = restarted.doc(target.timelineId);
    expect(videoItems(after)).toEqual(videoItems(cleaned));
    expect(after.revision).toBeGreaterThan(cleaned.revision);
  });
});
