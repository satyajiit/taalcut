// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { coverSettingsSchema, simpleEditorResultSchema, SIMPLE_EDITOR_COMMANDS as N } from '@taalcut/core';
import { expect, it } from 'vitest';
import { createTimelineService } from '../../src/service/service';
import { coverTool } from '../../src/tools/cover-tool';
import { commandWorld, ui } from '../fixtures/command-world';
import { agentToolContext } from '../fixtures/tool-context';
import { at, fixture } from './fixtures';

it('the person saves a whole cover; undo removes the additive data and redo restores it', async () => {
  const data = fixture();
  const cover = coverSettingsSchema.parse({
    aspect: '1:1',
    source: { kind: 'frame', frame: 12 },
    hookText: 'Market morning',
  });
  const world = commandWorld();
  await world.seed(structuredClone(data.timeline));
  const input = { ...data.target, cover };
  expect((await world.dispatch('timeline.setCover', input)).ok).toBe(true);
  expect(world.doc(data.timeline.id).covers).toEqual([cover]);
  expect((await world.bus.undo(data.timeline.projectId, ui)).ok).toBe(true);
  expect(world.doc(data.timeline.id).covers).toBeUndefined();
  expect((await world.bus.redo(data.timeline.projectId, ui)).ok).toBe(true);
  expect(world.doc(data.timeline.id).covers).toEqual([cover]);
  const before = structuredClone(world.doc(data.timeline.id));
  const late = { ...cover, source: { kind: 'frame', frame: 180 } };
  expect(
    (await world.dispatch('timeline.setCover', { ...input, revision: before.revision, cover: late })).ok,
  ).toBe(false);
  expect(world.doc(data.timeline.id)).toEqual(before);
});

/** A cover composition as workspace.placeCover saves it (CVR2); the files are not read here. */
const composed = (frame: number, second?: number) => ({
  entry: 'cover/index.html',
  files: [{ path: 'cover/index.html', sha256: 'a'.repeat(64), bytes: 10 }],
  hash: 'b'.repeat(64),
  variables: [],
  at: 1,
  pictures: [
    { name: 'hero', source: { kind: 'frame', frame } },
    ...(second === undefined ? [] : [{ name: 'second', source: { kind: 'frame', frame: second } }]),
  ],
});

it('the AI’s timeline.setCover sets the picture as it is, and nothing designed (CVR2)', async () => {
  const data = fixture();
  const world = commandWorld();
  await world.seed(structuredClone(data.timeline));
  const tool = coverTool(createTimelineService({ store: world.store, events: world.events }));
  const run = (cover: unknown, revision = world.doc(data.timeline.id).revision) =>
    tool.run(tool.input.parse({ ...data.target, revision, cover }), agentToolContext(world.bus, tool));
  const frame = { aspect: '1:1', source: { kind: 'frame', frame: 12 }, medium: 'footage' };

  // No design, no preset words, no composition: its schema has none of them.
  for (const extra of [{ hookText: 'Market morning' }, { design: {} }, { composition: composed(12) }])
    expect(tool.input.safeParse({ ...data.target, cover: { ...frame, ...extra } }).success).toBe(false);
  expect(
    tool.input.safeParse({ ...data.target, cover: { aspect: '1:1', source: frame.source } }).success,
  ).toBe(false);
  expect(tool.version).toBe('2.0.0');

  expect((await run(frame)).ok).toBe(true);
  expect(world.doc(data.timeline.id).covers).toEqual([coverSettingsSchema.parse(frame)]);

  // A hand-made cover keeps its own words under the new picture.
  const hand = coverSettingsSchema.parse({ aspect: '1:1', source: frame.source, hookText: 'Market morning' });
  const saved = await world.dispatch('timeline.setCover', {
    ...data.target,
    revision: world.doc(data.timeline.id).revision,
    cover: hand,
  });
  expect(saved.ok).toBe(true);
  expect((await run({ ...frame, source: { kind: 'frame', frame: 20 } })).ok).toBe(true);
  expect(world.doc(data.timeline.id).covers).toEqual([
    { ...hand, source: { kind: 'frame', frame: 20 }, medium: 'footage' },
  ]);
});

it('a composition cover leads with its first picture, inside the video, and is not re-pointed as a frame (CVR2)', async () => {
  const data = fixture();
  const world = commandWorld();
  await world.seed(structuredClone(data.timeline));
  const save = (composition: unknown, source: unknown = { kind: 'solid' }) =>
    world.dispatch('timeline.setCover', {
      ...data.target,
      revision: world.doc(data.timeline.id).revision,
      cover: { aspect: '9:16', source, medium: 'footage', composition },
    });
  // The source it was sent with is not what it draws: its lead picture is.
  expect((await save(composed(12))).ok).toBe(true);
  expect(world.doc(data.timeline.id).covers?.[0]).toMatchObject({
    source: { kind: 'frame', frame: 12 },
    medium: 'footage',
    composition: { entry: 'cover/index.html', params: {} },
  });
  expect((await save(composed(180))).ok).toBe(false);
  const late = await save(composed(12, 180));
  expect(!late.ok && late.error.detail).toContain('Picture "second" names a frame past the end of the video');

  const tool = coverTool(createTimelineService({ store: world.store, events: world.events }));
  const repointed = await tool.run(
    tool.input.parse({
      ...data.target,
      revision: world.doc(data.timeline.id).revision,
      cover: { aspect: '9:16', source: { kind: 'frame', frame: 3 }, medium: 'footage' },
    }),
    agentToolContext(world.bus, tool),
  );
  expect(!repointed.ok && repointed.error.detail).toContain('place it again with workspace.placeCover');
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
