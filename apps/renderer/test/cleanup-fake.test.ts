// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { callRpc, timelineSchema, type Clip, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { TALKING_PROJECT, TALKING_TIMELINE } from '../src/backend/fake/make/p3/seeds/cleanup';
import { cleanupOptions } from '../src/backend/fake/options/cleanup';

const projectId = TALKING_PROJECT;
const timelineId = TALKING_TIMELINE;

function setup(talkingHead = true) {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs: 0, areas: talkingHead ? { cleanup: { talkingHead } } : {} },
  });
  const dispatch = (name: string, payload: unknown, source: 'ui' | 'agent' = 'ui') =>
    source === 'agent'
      ? controls.bus.dispatch(name, payload, { source, actor: 'agent:test' })
      : callRpc(client.commands.dispatch({ name, payload, source }));
  const undo = () => callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const redo = () => callRpc(client.commands.redo({ projectId, source: 'ui' }));
  const timeline = () => client.timelines.get({ timelineId });
  return { client, dispatch, undo, redo, timeline };
}

const clips = (timeline: Timeline) =>
  timeline.tracks[0]!.items.filter((item): item is Clip => item.type === 'clip');
const frames = (timeline: Timeline) => clips(timeline).reduce((sum, clip) => sum + clip.duration.value, 0);

describe('cleanup fake (P3-V9)', () => {
  it('seeds the talking head only when asked', async () => {
    const plain = setup(false);
    await expect(plain.timeline()).rejects.toMatchObject({ data: { code: 'core.not_found' } });
    expect(cleanupOptions({})).toEqual({});
    expect(cleanupOptions({ cleanup: { talkingHead: true } })).toEqual({
      make: { areas: { cleanup: { talkingHead: true } } },
    });
    const s = setup();
    const timeline = await s.timeline();
    expect(clips(timeline)).toHaveLength(3);
    expect(timeline.beatMap).toBeNull();
    expect(timeline.captions?.cues.length).toBeGreaterThan(5);
  });

  it('plans fillers, pauses, a retake and punch-ins; the switches change the plan', async () => {
    const s = setup();
    const before = await s.timeline();
    const plan = await s.client.timelines.planCleanup({ timelineId });
    expect(plan.revision).toBe(before.revision);
    expect(plan.clipsFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.stats.fillers).toBeGreaterThan(0);
    expect(plan.stats.pauses).toBeGreaterThan(0);
    expect(plan.stats.retakes).toBeGreaterThan(0);
    expect(plan.stats.punchIns).toBeGreaterThan(0);
    expect(plan.stats.secondsSaved).toBeGreaterThan(1);

    const noFillers = await s.client.timelines.planCleanup({ timelineId, settings: { fillers: false } });
    expect(noFillers.stats.fillers).toBe(0);
    expect(noFillers.stats.secondsSaved).toBeLessThan(plan.stats.secondsSaved);
    const longer = await s.client.timelines.planCleanup({ timelineId, settings: { pauseThresholdMs: 2000 } });
    expect(longer.stats.pauses).toBeLessThan(plan.stats.pauses);
    const none = await s.client.timelines.planCleanup({
      timelineId,
      settings: { fillers: false, pauses: false, retakes: false, punchIns: false },
    });
    expect(none.clips).toEqual([]);
    await expect(s.client.timelines.planCleanup({ timelineId: GOLDEN_TIMELINES[0]! })).rejects.toMatchObject({
      data: { code: 'timeline.cleanup_no_speech' },
    });
  });

  it('apply cuts the plan in one undo step: shorter, captions moved, ⌘Z and redo', async () => {
    const s = setup();
    const before = await s.timeline();
    const plan = await s.client.timelines.planCleanup({ timelineId });
    const applied = await s.dispatch('timeline.applyCleanup', { projectId, timelineId, plan });
    expect(applied.ok).toBe(true);
    const after = await s.timeline();
    expect(timelineSchema.safeParse(after).error?.issues ?? []).toEqual([]);
    expect(frames(before) - frames(after)).toBe(Math.round(plan.stats.secondsSaved * 30));
    expect(clips(after).length).toBe(3 + plan.clips.reduce((sum, clip) => sum + clip.newIds.length, 0));
    expect(clips(after).some((clip) => clip.reframe?.scale === 1.1)).toBe(true);
    const lastCue = after.captions!.cues.at(-1)!;
    expect(lastCue.range.start.value + lastCue.range.duration.value).toBeLessThanOrEqual(frames(after));

    expect((await s.undo()).ok).toBe(true);
    expect((await s.timeline()).tracks).toEqual(before.tracks);
    expect((await s.redo()).ok).toBe(true);
    expect(frames(await s.timeline())).toBe(frames(after));
  });

  it('a stale plan is refused unless its clips are as they were; the agent may not cut a locked clip', async () => {
    const s = setup();
    const plan = await s.client.timelines.planCleanup({ timelineId });
    // An unrelated edit (the captions off and on) moves the revision but not the clips: the plan still applies.
    await s.dispatch('captions.setEnabled', { projectId, timelineId, enabled: false });
    const unrelated = await s.dispatch('timeline.applyCleanup', { projectId, timelineId, plan });
    expect(unrelated.ok).toBe(true);
    await s.undo();

    const fresh = await s.client.timelines.planCleanup({ timelineId });
    const first = clips(await s.timeline())[0]!;
    // Moving a take changes the clips the plan names (their order): the plan is stale.
    const moved = await s.dispatch('timeline.moveClip', {
      projectId,
      timelineId,
      clipId: first.id,
      toIndex: 2,
    });
    expect(moved.ok).toBe(true);
    const stale = await s.dispatch('timeline.applyCleanup', { projectId, timelineId, plan: fresh });
    expect(stale.ok ? null : stale.error).toMatchObject({
      code: 'timeline.cleanup_stale',
      params: { revision: fresh.revision },
    });

    const now = await s.client.timelines.planCleanup({ timelineId });
    const named = now.clips[0]!.clipId;
    await s.dispatch('timeline.lockClip', { projectId, timelineId, clipId: named, locked: true });
    const locked = await s.client.timelines.planCleanup({ timelineId });
    const refused = await s.dispatch(
      'timeline.applyCleanup',
      { projectId, timelineId, plan: locked },
      'agent',
    );
    expect(refused.ok ? null : refused.error.code).toBe('timeline.clip_locked');
  });
});
