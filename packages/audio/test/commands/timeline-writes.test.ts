// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { MIX_COMMANDS, newId, RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { trackOfRole } from '../../src/commands/audio-track';
import { createSfxCommands } from '../../src/sfx/hits-command';
import { busWith, memoryTimelineStore, UI } from '../helpers/bus';
import { makeTestTimeline } from '../helpers/timeline';

describe("audio's timeline writer", () => {
  it('refuses a stale revision, yet redoes a payload whose revision the undo moved past', async () => {
    const timeline = makeTestTimeline({ clips: [{ frames: 90 }] });
    const store = memoryTimelineStore(timeline);
    const { bus } = busWith(store, (deps) => createSfxCommands(deps).all);
    const target = { projectId: timeline.projectId, timelineId: timeline.id };

    const stale = await bus.dispatch(
      MIX_COMMANDS.setHits,
      { ...target, revision: timeline.revision + 5, hits: [] },
      UI,
    );
    expect(stale.ok ? 'ok' : stale.error.code).toBe('core.conflict');

    const done = await bus.dispatch(
      MIX_COMMANDS.setHits,
      { ...target, revision: timeline.revision, hits: [] },
      UI,
    );
    expect(done.ok).toBe(true);
    expect(store.current(timeline.id).revision).toBe(timeline.revision + 1);
    await bus.undo(timeline.projectId, UI);
    expect(store.current(timeline.id).revision).toBe(timeline.revision + 2);
    const redone = await bus.redo(timeline.projectId, UI);
    expect(redone.ok && redone.value?.name).toBe(MIX_COMMANDS.setHits);
    expect(store.current(timeline.id).revision).toBe(timeline.revision + 3);
  });

  it('redoes after a restart: a new bus on the same audit log runs the payload as a redo', async () => {
    const timeline = makeTestTimeline({ clips: [{ frames: 90 }] });
    const store = memoryTimelineStore(timeline);
    const first = busWith(store, (deps) => createSfxCommands(deps).all);
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const ms = (value: number) => RationalTime.of(value, { num: 1000, den: 1 });
    const hits = [
      {
        id: newId<'TimelineItem'>(),
        at: ms(500),
        assetId: newId<'Asset'>(),
        sourceStart: ms(0),
        duration: ms(400),
        gainDb: -6,
        category: 'whoosh' as const,
      },
    ];
    const done = await first.bus.dispatch(
      MIX_COMMANDS.setHits,
      { ...target, revision: timeline.revision, hits },
      UI,
    );
    expect(done.ok).toBe(true);
    expect((await first.bus.undo(timeline.projectId, UI)).ok).toBe(true);
    expect(store.current(timeline.id).revision).toBe(timeline.revision + 2);

    const restarted = busWith(store, (deps) => createSfxCommands(deps).all, first.audit);
    const redone = await restarted.bus.redo(timeline.projectId, UI);
    expect(redone.ok ? redone.value?.name : redone.error.code).toBe(MIX_COMMANDS.setHits);
    expect(store.current(timeline.id).revision).toBe(timeline.revision + 3);
    expect(
      trackOfRole(store.current(timeline.id), 'sfx')?.items.filter((item) => item.type === 'clip'),
    ).toHaveLength(1);
    // Announced once the redo committed, on the new bus.
    expect(restarted.changed).toEqual([[timeline.id]]);
  });

  it('keeps the guard for a new command after a redo', async () => {
    const timeline = makeTestTimeline({ clips: [{ frames: 90 }] });
    const store = memoryTimelineStore(timeline);
    const { bus } = busWith(store, (deps) => createSfxCommands(deps).all);
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    await bus.dispatch(MIX_COMMANDS.setHits, { ...target, revision: timeline.revision, hits: [] }, UI);
    await bus.undo(timeline.projectId, UI);
    await bus.redo(timeline.projectId, UI);
    const again = await bus.dispatch(
      MIX_COMMANDS.setHits,
      { ...target, revision: timeline.revision, hits: [] },
      UI,
    );
    expect(again.ok ? 'ok' : again.error.code).toBe('core.conflict');
  });
});
