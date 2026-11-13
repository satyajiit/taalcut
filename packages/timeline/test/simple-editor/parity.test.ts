// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  agentTurnGroup,
  newId,
  ok,
  SIMPLE_EDITOR_COMMANDS as N,
  simpleEditorResultSchema,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTimelineService } from '../../src/service/service';
import { simpleEditorTools } from '../../src/tools/simple-editor-tools';
import { commandWorld, ui } from '../fixtures/command-world';
import { agentToolContext } from '../fixtures/tool-context';
import { at, fixture } from './fixtures';

const effect = (doc: Timeline) => ({
  canvas: doc.canvas,
  music: doc.music,
  captions: doc.captions,
  tracks: doc.tracks.map((track) => ({
    kind: track.kind,
    items: track.items.map((item) => {
      const { id: _id, ...rest } = item;
      return rest;
    }),
  })),
});

describe('simple editor UI / AI parity', () => {
  const cases = [
    N.replaceCaptions,
    N.adjustClips,
    N.copyClipSettings,
    N.freezeFrame,
    N.setHoldDuration,
    N.makeSize,
    N.removeWords,
    N.addNarration,
  ];
  it.each(cases)('%s commits the same edit and undoes as one operation', async (name) => {
    const data = fixture();
    if (name === N.setHoldDuration) {
      data.first.holdFrame = at(0);
      data.first.speed = null;
      data.first.audio.muted = true;
    }
    const assetId = newId<'Asset'>();
    const inputs = {
      [N.replaceCaptions]: { find: 'hello', replacement: 'Welcome', matchCase: false },
      [N.adjustClips]: { clipIds: data.ids, sound: { muted: false, gainDb: -6 } },
      [N.copyClipSettings]: {
        sourceClipId: data.ids[0],
        clipIds: [data.ids[1]],
        settings: ['color', 'sound', 'framing'],
      },
      [N.freezeFrame]: { clipId: data.ids[0], at: at(14), duration: at(60) },
      [N.setHoldDuration]: { clipId: data.ids[0], duration: at(60) },
      [N.makeSize]: { aspect: '1:1' },
      [N.removeWords]: {
        words: [
          {
            clipId: data.ids[0],
            assetId: data.first.media.assetId,
            segment: 0,
            word: 1,
            source: { start: at(15), duration: at(30) },
          },
        ],
      },
      [N.addNarration]: { assetId, at: at(30) },
    };
    const docs: Timeline[] = [];
    for (const origin of ['ui', 'ai'] as const) {
      const world = commandWorld({
        transcripts: async () => ok(data.transcript),
        narration: async () => ok({ assetId, duration: at(30) }),
      });
      await world.seed(structuredClone(data.timeline));
      const service = createTimelineService({
        store: world.store,
        events: world.events,
        transcripts: async () => ok(data.transcript),
      });
      const tool = simpleEditorTools(service).find((entry) => entry.name === name)!;
      const input = { ...data.target, ...inputs[name] };
      const done =
        origin === 'ui'
          ? await world.dispatch(name, input)
          : await tool.run(tool.input.parse(input), agentToolContext(world.bus, tool));
      expect(done.ok, JSON.stringify(done)).toBe(true);
      if (!done.ok) return;
      const receipt = simpleEditorResultSchema.parse(done.value);
      const written = world.doc(receipt.timelineId);
      expect(written.revision).toBe(receipt.revision);
      docs.push(structuredClone(written));
      expect((await world.bus.undo(data.timeline.projectId, ui)).ok).toBe(true);
      if (name === N.makeSize) expect(world.memory.docs.has(receipt.timelineId)).toBe(false);
      else expect(effect(world.doc(data.timeline.id))).toEqual(effect(data.timeline));
      expect((await world.bus.redo(data.timeline.projectId, ui)).ok).toBe(true);
      expect(effect(world.doc(receipt.timelineId))).toEqual(effect(written));
    }
    expect(effect(docs[0]!)).toEqual(effect(docs[1]!));
  });

  it('exposes JSON-compatible inputs and complete metadata for every new tool', () => {
    const world = commandWorld();
    const service = createTimelineService({ store: world.store, events: world.events });
    const tools = simpleEditorTools(service);
    expect(tools.map((tool) => tool.name)).toEqual(['timeline.transcript', ...Object.values(N)]);
    for (const tool of tools) {
      expect(() => z.toJSONSchema(tool.input, { io: 'input' })).not.toThrow();
      expect(() => z.toJSONSchema(tool.output, { io: 'output' })).not.toThrow();
      expect(tool.retry).toBeDefined();
      expect(tool.idempotencyKey).toBeTypeOf('function');
      expect(tool.summary!.length).toBeLessThanOrEqual(120);
    }
  });

  it('refuses stale revisions before writes and rejects a repeated stale request', async () => {
    const data = fixture();
    const world = commandWorld();
    await world.seed(data.timeline);
    const input = { ...data.target, clipIds: data.ids, sound: { gainDb: -6 } };
    expect((await world.dispatch(N.adjustClips, input)).ok).toBe(true);
    const saved = structuredClone(world.doc(data.timeline.id));
    const retry = await world.dispatch(N.adjustClips, input);
    expect(retry).toMatchObject({ ok: false, error: { code: 'core.conflict' } });
    expect(world.doc(data.timeline.id)).toEqual(saved);
  });
});

it('redoes an adjustment and its independent size copy as a single AI group', async () => {
  const data = fixture();
  const world = commandWorld();
  await world.seed(data.timeline);
  const runId = newId<'AgentRun'>();
  const origin = { source: 'agent', actor: `agent:${runId}` } as const;
  const options = { group: agentTurnGroup(runId) };
  const adjusted = await world.bus.dispatch(
    N.adjustClips,
    {
      ...data.target,
      clipIds: data.ids,
      sound: { gainDb: -6 },
    },
    origin,
    options,
  );
  expect(adjusted.ok).toBe(true);
  const copied = await world.bus.dispatch(
    N.makeSize,
    {
      ...data.target,
      revision: world.doc(data.timeline.id).revision,
      aspect: '1:1',
    },
    origin,
    options,
  );
  expect(copied.ok).toBe(true);
  if (!copied.ok) return;
  const copyId = simpleEditorResultSchema.parse(copied.value.result).timelineId;
  const copy = structuredClone(world.doc(copyId));
  expect((await world.bus.undo(data.timeline.projectId, ui)).ok).toBe(true);
  expect(world.memory.docs.has(copyId)).toBe(false);
  expect(effect(world.doc(data.timeline.id))).toEqual(effect(data.timeline));
  expect((await world.bus.redo(data.timeline.projectId, ui)).ok).toBe(true);
  expect(effect(world.doc(copyId))).toEqual(effect(copy));
});
