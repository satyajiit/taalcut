// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render QA's command fixes (P2-M8) on core's command bus: timeline.setClipFit
 * and timeline.resyncBeats are undoable, refuse agents on locked clips, and
 * write nothing when there is nothing to fix.
 */
import {
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  type CommandOrigin,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTimelineCommands } from '../src/commands/commands';
import { createMemoryTimelineStore } from './fixtures/store';
import { buildTimeline, clipById, starts, type ClipDef } from './fixtures/timeline';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const agent: CommandOrigin = { source: 'agent', actor: 'agent:run' };

async function setup(clips: ClipDef[], beats = true) {
  const clock = createManualClock(1_000);
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  const store = createMemoryTimelineStore();
  bus.register(...createTimelineCommands({ store, events: createEventBus({ clock }), clock }).all);
  const built = buildTimeline({ clips, beats });
  await bus.dispatch(
    'timeline.create',
    { projectId: built.timeline.projectId, timelines: [built.timeline] },
    ui,
  );
  const target = { projectId: built.timeline.projectId, timelineId: built.timeline.id };
  const read = () => store.docs.get(built.timeline.id) as Timeline;
  return { bus, built, target, read };
}

describe('timeline.setClipFit', () => {
  it('sets a clip to cover or contain, undoably, and refuses agents on a locked clip', async () => {
    const { bus, built, target, read } = await setup([{ frames: 30 }, { frames: 30, locked: true }]);
    const first = built.ids[0]!;
    const before = clipById(read(), first).fit;
    const other = before === 'cover' ? 'contain' : 'cover';
    expect(
      (await bus.dispatch('timeline.setClipFit', { ...target, clipId: first, fit: other }, agent)).ok,
    ).toBe(true);
    expect(clipById(read(), first).fit).toBe(other);
    await bus.undo(target.projectId, ui);
    expect(clipById(read(), first).fit).toBe(before);

    const revision = read().revision;
    expect(
      (await bus.dispatch('timeline.setClipFit', { ...target, clipId: first, fit: before }, ui)).ok,
    ).toBe(true);
    expect(read().revision).toBe(revision);

    const locked = await bus.dispatch(
      'timeline.setClipFit',
      { ...target, clipId: built.ids[1], fit: other },
      agent,
    );
    expect(!locked.ok && locked.error.code).toBe('timeline.clip_locked');
  });
});

describe('timeline.resyncBeats', () => {
  it('puts drifted cuts back on the beat grid in one undoable step', async () => {
    const { bus, target, read } = await setup([{ frames: 32 }, { frames: 28 }, { frames: 30 }]);
    expect(starts(read())).toEqual([0, 32, 60, 90]);
    expect((await bus.dispatch('timeline.resyncBeats', target, agent)).ok).toBe(true);
    expect(starts(read())).toEqual([0, 30, 60, 90]);
    await bus.undo(target.projectId, ui);
    expect(starts(read())).toEqual([0, 32, 60, 90]);
  });

  it('writes nothing without a beat map or when the cuts are on it, and keeps agents off locked clips', async () => {
    for (const beats of [false, true]) {
      const { bus, target, read } = await setup([{ frames: 30 }, { frames: 30 }], beats);
      const revision = read().revision;
      expect((await bus.dispatch('timeline.resyncBeats', target, ui)).ok).toBe(true);
      expect(read().revision).toBe(revision);
    }
    const { bus, target, read } = await setup([{ frames: 32, locked: true }, { frames: 28 }]);
    const refused = await bus.dispatch('timeline.resyncBeats', target, agent);
    expect(!refused.ok && refused.error.code).toBe('timeline.clip_locked');
    expect((await bus.dispatch('timeline.resyncBeats', target, ui)).ok).toBe(true);
    expect(starts(read())).toEqual([0, 30, 60]);
  });
});
