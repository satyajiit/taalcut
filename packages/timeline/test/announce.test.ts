// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * library.changed for timeline commands comes only after the command commits
 * (library SPEC, P2-X3 as built): after the audit append, never for an append
 * that failed, and again for undo and redo.
 */
import {
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  err,
  RationalTime,
  UnknownError,
  type AuditLogStore,
  type CommandOrigin,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTimelineCommands } from '../src/commands/commands';
import { createMemoryTimelineStore } from './fixtures/store';
import { buildTimeline } from './fixtures/timeline';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

function setup() {
  const clock = createManualClock(1_000);
  const log: string[] = [];
  const memory = createMemoryAuditLogStore();
  let failNext = false;
  const audit: AuditLogStore = {
    ...memory,
    async append(entry) {
      if (failNext) {
        failNext = false;
        log.push(`append failed:${entry.name}`);
        return err(UnknownError(undefined, { detail: 'disk full' }));
      }
      log.push(`append:${entry.name}`);
      return memory.append(entry);
    },
  };
  const bus = createCommandBus({ store: audit, clock });
  const events = createEventBus({ clock });
  events.on('library.changed', (event) => log.push(`changed:${event.payload.change}`));
  const store = createMemoryTimelineStore();
  const commands = createTimelineCommands({ store, events, clock });
  bus.register(...commands.all);
  commands.announce(bus);
  const built = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
  const target = { projectId: built.timeline.projectId, timelineId: built.timeline.id };
  return { bus, log, built, target, failNext: () => (failNext = true) };
}

describe('timeline library.changed', () => {
  it('is sent after the command commits, for executes, undos and redos', async () => {
    const { bus, log, built, target } = setup();
    await bus.dispatch('timeline.create', { projectId: target.projectId, timelines: [built.timeline] }, ui);
    const trim = { ...target, clipId: built.ids[1], edge: 'end', by: RationalTime.of(10, built.timeline.canvas.rate) };
    const trimmed = await bus.dispatch('timeline.trimClip', trim, ui);
    expect(trimmed.ok).toBe(true);
    await bus.undo(target.projectId, ui);
    await bus.redo(target.projectId, ui);
    expect(log).toEqual([
      'append:timeline.create',
      'changed:created',
      'append:timeline.trimClip',
      'changed:updated',
      // Undo runs timeline.restore; redo runs the trim again. Both commit before they announce.
      'changed:updated',
      'changed:updated',
    ]);
  });

  it('is never sent for a command whose audit append failed', async () => {
    const { bus, log, built, target, failNext } = setup();
    await bus.dispatch('timeline.create', { projectId: target.projectId, timelines: [built.timeline] }, ui);
    log.length = 0;
    failNext();
    const failed = await bus.dispatch('timeline.lockClip', { ...target, clipId: built.ids[0], locked: true }, ui);
    expect(failed.ok).toBe(false);
    expect(log).toEqual(['append failed:timeline.lockClip']);
  });
});
