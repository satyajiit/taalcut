// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The refresher waits for templates to stay quiet, then checks every stored profile once (and builds the watched
 * collections' sets); a nudged set is built by name; nothing else wakes it; it stops when told.
 */
import {
  createEventBus,
  createManualClock,
  ok,
  type StyleSource,
  type TemplateFolderId,
} from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStyleProfileRefresher } from '../../src/profiles/refresher';
import { syntheticId } from '../../src/profiles/synthetic-set';

const WATCHED: StyleSource = { kind: 'instagram-collection', collectionId: 'col_watch' };
const NUDGED: StyleSource = { kind: 'folder', folderId: syntheticId<TemplateFolderId>(4, 1) };

function setup() {
  const events = createEventBus({ clock: createManualClock() });
  const calls: string[] = [];
  const profiles = {
    refresh: vi.fn(
      async (source: StyleSource) => (calls.push(`refresh ${source.kind}`), ok('built' as const)),
    ),
    refreshAll: vi.fn(async () => (calls.push('all'), ok(0))),
  };
  const refresher = createStyleProfileRefresher({
    profiles,
    events,
    watched: async () => [WATCHED],
    quietMs: 1_000,
  });
  const template = () =>
    events.emit('library.changed', { projectId: null, entity: 'template', change: 'updated', ids: [] });
  return { events, calls, refresher, template };
}

describe('the style profile refresher', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('waits for a quiet spell, then refreshes the watched sets and every stored profile once', async () => {
    const { calls, refresher, template } = setup();
    template();
    await vi.advanceTimersByTimeAsync(600);
    template();
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    await refresher.idle();
    expect(calls).toEqual(['refresh instagram-collection', 'all']);
    refresher.stop();
  });

  it('builds a nudged set by name, and ignores other entities', async () => {
    const { calls, refresher, events } = setup();
    events.emit('library.changed', { projectId: null, entity: 'memory', change: 'updated', ids: [] });
    refresher.nudge([NUDGED]);
    await vi.advanceTimersByTimeAsync(1_000);
    await refresher.idle();
    expect(calls).toEqual(['refresh folder']);
    refresher.stop();
  });

  it('runs nothing after it stops', async () => {
    const { calls, refresher, template } = setup();
    template();
    refresher.stop();
    template();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toEqual([]);
  });
});
