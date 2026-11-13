// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V3: `timeline.makeVariants` is one request and one `timeline.create`; one ⌘Z removes all five, the base
 * stays as it was, and a retried call (same key) plans the same variants.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { agentWorld } from '../fixtures/agent';

const twelve = { slots: 12, perSlot: 8, distractors: 60, seed: 11 };

async function baseOf(world: ReturnType<typeof agentWorld>): Promise<string> {
  const assembled = await world.call('timeline.assemble', {
    projectId: world.projectId,
    template: { id: world.template.id },
  });
  if (!assembled.ok) throw new Error(assembled.error.code);
  const [timelineId] = assembled.value.timelineIds as string[];
  if (!timelineId) throw new Error('no base');
  return timelineId;
}

describe('timeline.makeVariants', () => {
  it('makes five hook variants in one timeline.create that one undo removes', async () => {
    const world = agentWorld(twelve);
    const baseId = await baseOf(world);
    const before = world.store.docs.get(baseId);
    const dispatched: string[] = [];
    world.bus.subscribe((event) => {
      if (event.kind === 'executed') dispatched.push(event.name);
    });
    const made = await world.call('timeline.makeVariants', {
      projectId: world.projectId,
      baseTimelineId: baseId,
      count: 5,
      axes: ['hook'],
    });
    if (!made.ok) throw new Error(made.error.code);
    const timelineIds = made.value.timelineIds as string[];
    expect(timelineIds).toHaveLength(5);
    expect(dispatched).toEqual(['timeline.create']);
    expect(world.store.docs.size).toBe(6);
    const differences = made.value.differences as { hookChanged: boolean; picksChanged: number }[];
    for (const difference of differences) {
      expect(difference.hookChanged).toBe(true);
      expect(difference.picksChanged).toBeGreaterThanOrEqual(0.3);
    }
    expect(made.value.variantsShort).toBeUndefined();
    expect(world.store.docs.get(baseId)).toEqual(before);

    await world.bus.undo(world.projectId, { source: 'ui', actor: 'user' });
    expect([...world.store.docs.keys()]).toEqual([baseId]);
  });

  it('names the same variants for the same key', async () => {
    const world = agentWorld(twelve);
    const baseId = await baseOf(world);
    const input = { projectId: world.projectId, baseTimelineId: baseId, count: 2, axes: ['hook'] };
    const tool = world.tools.tools.find((candidate) => candidate.name === 'timeline.makeVariants');
    const key = tool?.idempotencyKey?.(tool.input.parse(input));
    expect(key).toBe(
      `timeline.makeVariants:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`,
    );
    const first = await world.call('timeline.makeVariants', input);
    if (!first.ok) throw new Error(first.error.code);
    await world.bus.undo(world.projectId, { source: 'ui', actor: 'user' });
    const again = await world.call('timeline.makeVariants', input);
    if (!again.ok) throw new Error(again.error.code);
    expect(again.value.differences).toEqual(first.value.differences);
  });

  it('refuses a base from another project', async () => {
    const world = agentWorld(twelve);
    const baseId = await baseOf(world);
    const other = await world.call('timeline.makeVariants', {
      projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      baseTimelineId: baseId,
      count: 2,
      axes: ['hook'],
    });
    expect(!other.ok && other.error.code).toBe('core.validation');
  });
});
