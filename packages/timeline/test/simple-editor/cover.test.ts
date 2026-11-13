// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { coverSettingsSchema, simpleEditorResultSchema, SIMPLE_EDITOR_COMMANDS as N } from '@taalcut/core';
import { expect, it } from 'vitest';
import { createTimelineService } from '../../src/service/service';
import { coverTool } from '../../src/tools/cover-tool';
import { commandWorld, ui } from '../fixtures/command-world';
import { agentToolContext } from '../fixtures/tool-context';
import { at, fixture } from './fixtures';

it('the editor and AI save the same cover; undo removes the additive data and redo restores it', async () => {
  const data = fixture();
  const cover = coverSettingsSchema.parse({
    aspect: '1:1',
    source: { kind: 'frame', frame: 12 },
    hookText: 'Market morning',
  });
  for (const source of ['ui', 'ai']) {
    const world = commandWorld();
    await world.seed(structuredClone(data.timeline));
    const input = { ...data.target, cover };
    const tool = coverTool(createTimelineService({ store: world.store, events: world.events }));
    const result =
      source === 'ui'
        ? await world.dispatch('timeline.setCover', input)
        : await tool.run(tool.input.parse(input), agentToolContext(world.bus, tool));
    expect(result.ok).toBe(true);
    expect(world.doc(data.timeline.id).covers).toEqual([cover]);
    expect((await world.bus.undo(data.timeline.projectId, ui)).ok).toBe(true);
    expect(world.doc(data.timeline.id).covers).toBeUndefined();
    expect((await world.bus.redo(data.timeline.projectId, ui)).ok).toBe(true);
    expect(world.doc(data.timeline.id).covers).toEqual([cover]);
    const before = structuredClone(world.doc(data.timeline.id));
    expect(
      (
        await world.dispatch('timeline.setCover', {
          ...input,
          revision: before.revision,
          cover: { ...cover, source: { kind: 'frame', frame: 180 } },
        })
      ).ok,
    ).toBe(false);
    expect(world.doc(data.timeline.id)).toEqual(before);
  }
});

it('changing a held frame duration is undoable and preserves its exact source frame', async () => {
  const data = fixture();
  const world = commandWorld();
  await world.seed(data.timeline);
  const frozen = await world.dispatch(N.freezeFrame, {
    ...data.target,
    clipId: data.ids[0],
    at: at(17),
    duration: at(60),
  });
  expect(frozen.ok).toBe(true);
  if (!frozen.ok) return;
  const receipt = simpleEditorResultSchema.parse(frozen.value);
  const held = structuredClone(world.doc(data.timeline.id));
  const done = await world.dispatch(N.setHoldDuration, {
    ...data.target,
    revision: receipt.revision,
    clipId: receipt.itemId,
    duration: at(90),
  });
  expect(done.ok).toBe(true);
  const clip = world.doc(data.timeline.id).tracks[0]!.items.find((item) => item.id === receipt.itemId);
  expect(clip).toMatchObject({ duration: { value: 90 }, holdFrame: { value: 17 }, audio: { muted: true } });
  expect((await world.bus.undo(data.timeline.projectId, ui)).ok).toBe(true);
  expect(world.doc(data.timeline.id).tracks).toEqual(held.tracks);
});
