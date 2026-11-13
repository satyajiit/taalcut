// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, unwrap } from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { createPrepareNarration } from '../../src/tools/prepare-narration';
import { commandWorld, ui } from '../fixtures/command-world';
import { agentToolContext } from '../fixtures/tool-context';
import { fixture } from './fixtures';

async function setup() {
  const data = fixture(),
    world = commandWorld();
  await world.seed(data.timeline);
  const emit = vi.fn();
  const prepared = createPrepareNarration({ timelines: world.store, events: { emit } });
  world.bus.register(prepared.command);
  return { ...data, ...world, emit, prepared };
}

it('the tool only requests the recorder panel at the inspected frame, without editing the video', async () => {
  const world = await setup();
  const tool = world.prepared.tools.tools[0]!;
  const before = structuredClone(world.doc(world.timeline.id));
  const result = unwrap(
    await tool.run(tool.input.parse({ ...world.target, frame: 17 }), agentToolContext(world.bus, tool)),
  );
  expect(result).toMatchObject({ ...world.target, frame: 17, prepared: true });
  expect(world.emit).toHaveBeenCalledExactlyOnceWith('ui.action', {
    action: 'timeline.prepareNarration',
    args: { projectId: world.timeline.projectId, timelineId: world.timeline.id, revision: '1', frame: '17' },
  });
  expect(world.doc(world.timeline.id)).toEqual(before);
  expect(unwrap(await world.bus.history(world.timeline.projectId))).toEqual({ undo: null, redo: null });
});

it('refuses stale, wrong-project and out-of-video preparation without requesting UI or microphone work', async () => {
  const world = await setup();
  for (const change of [{ revision: 2 }, { frame: 180 }, { projectId: newId<'Project'>() }]) {
    expect(
      (await world.bus.dispatch(world.prepared.command, { ...world.target, frame: 17, ...change }, ui)).ok,
    ).toBe(false);
  }
  expect(world.emit).not.toHaveBeenCalled();
});
