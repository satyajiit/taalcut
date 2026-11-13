// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { BATCH_COMMANDS, batchStyleResultSchema } from '@taalcut/core';
import { expect, it } from 'vitest';
import { createTimelineService } from '../../src/service/service';
import { editTools } from '../../src/tools/edit-tools';
import { commandWorld } from '../fixtures/command-world';
import { agentToolContext } from '../fixtures/tool-context';
import { fixture } from './fixtures';

it('rejects a positional edit when the document changes during payload resolution', async () => {
  const data = fixture();
  const world = commandWorld();
  await world.seed(data.timeline);
  const service = createTimelineService({ store: world.store, events: world.events });
  let reads = 0;
  const tool = editTools({
    service: {
      read: async (id) => {
        const answer = await service.read(id);
        if (++reads === 2) {
          const changed = await world.dispatch('timeline.duplicateClip', {
            ...data.target,
            clipId: data.ids[0],
          });
          expect(changed.ok).toBe(true);
        }
        return answer;
      },
    },
  }).find((tool) => tool.name === 'timeline.moveClip')!;
  const { revision: _revision, ...target } = data.target;
  const result = await tool.run(
    tool.input.parse({ ...target, clip: data.ids[0], to: 'end' }),
    agentToolContext(world.bus, tool),
  );
  expect(result).toMatchObject({ ok: false, error: { code: 'core.conflict' } });
  const ids = world.doc(data.timeline.id).tracks[0]!.items.map((item) => item.id);
  expect(ids[0]).toBe(data.ids[0]);
  expect(ids.at(-1)).toBe(data.ids[1]);
});

it('validates every batch revision before committing and returns verifiable receipts', async () => {
  const first = fixture(),
    second = fixture();
  const world = commandWorld();
  await world.seed(first.timeline, second.timeline);
  const apply = { kind: 'captionPreset' as const, presetId: 'bold' as const };
  const items = [first.target, second.target];
  const refused = await world.dispatch(BATCH_COMMANDS.applyStyle, {
    items: [items[0], { ...items[1], revision: 999 }],
    apply,
  });
  expect(refused).toMatchObject({ ok: false, error: { code: 'core.conflict' } });
  expect(world.doc(first.timeline.id)).toEqual(first.timeline);
  expect(world.doc(second.timeline.id)).toEqual(second.timeline);
  const done = await world.dispatch(BATCH_COMMANDS.applyStyle, { items, apply });
  expect(done.ok).toBe(true);
  if (!done.ok) return;
  const result = batchStyleResultSchema.parse(done.value);
  expect(result.receipts).toHaveLength(2);
  for (const receipt of result.receipts!) {
    const committed = world.doc(receipt.timelineId);
    expect(receipt.revision).toBe(committed.revision);
    expect(receipt.affectedItemIds).toEqual(committed.captions!.cues.map((cue) => cue.id));
  }
});
