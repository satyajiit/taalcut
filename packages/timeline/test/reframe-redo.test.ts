// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Review M10: `timeline.setReframe` names the revision it was read at, and the bus redoes a command with its stored
 * payload. Undo writes a new revision, so the redo must not be refused for the revision undo itself made; a change
 * someone else made meanwhile still is.
 */
import { describe, expect, it } from 'vitest';
import { agentWorld } from './fixtures/agent';

const person = { source: 'ui', actor: 'user' } as const;
const punchIn = { mode: 'centre', nudge: { x: 0, y: 0 }, scale: 1.4 } as const;

async function assembled() {
  const world = agentWorld();
  const made = await world.call('timeline.assemble', {
    projectId: world.projectId,
    template: { id: world.template.id },
  });
  if (!made.ok) throw new Error(made.error.code);
  const timelineId = (made.value.timelineIds as string[])[0]!;
  const read = await world.call('timeline.get', { timelineId });
  if (!read.ok) throw new Error(read.error.code);
  const clipId = (read.value.clips as { clipId: string }[])[0]!.clipId;
  const reframeOf = () => {
    const doc = world.store.docs.get(timelineId)!;
    const clip = doc.tracks[0]!.items.find((item) => item.id === clipId);
    return clip && clip.type === 'clip' ? (clip.reframe ?? null) : undefined;
  };
  return { ...world, timelineId, clipId, revision: read.value.revision as number, reframeOf };
}

describe('timeline.setReframe with a revision', () => {
  it('redoes after undo, the framing back as it was', async () => {
    const { call, bus, projectId, timelineId, clipId, revision, reframeOf } = await assembled();
    const set = await call('timeline.setReframe', {
      projectId,
      timelineId,
      clipId,
      revision,
      reframe: punchIn,
    });
    expect(set.ok).toBe(true);
    expect(reframeOf()).toEqual(punchIn);

    const undone = await bus.undo(projectId, person);
    expect(undone.ok && undone.value?.name).toBe('timeline.setReframe');
    expect(reframeOf()).toBeNull();

    const redone = await bus.redo(projectId, person);
    expect(redone.ok ? redone.value?.name : redone.error.code).toBe('timeline.setReframe');
    expect(reframeOf()).toEqual(punchIn);
  });

  it('still refuses a first run at a revision that has moved on', async () => {
    const { call, projectId, timelineId, clipId, revision } = await assembled();
    const moved = await call('timeline.lockClip', { projectId, timelineId, clipId, locked: true });
    expect(moved.ok).toBe(true);
    const stale = await call('timeline.setReframe', {
      projectId,
      timelineId,
      clipId,
      revision,
      reframe: punchIn,
    });
    expect(!stale.ok && stale.error.code).toBe('core.conflict');
  });
});
