// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The graphics commands and tools on compositions alone (HFW1 retire): graphics.list shows each graphic's design, its
 * variables and values with look-alike fences defused; "Use it" makes a proposal part of the video and undo makes it
 * one again; remove takes a graphic off and undo puts it back; graphics.edit's tool refuses moving or resizing a
 * graphic, which is graphics.design's. The module is list, edit, remove and design.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRAPHICS_COMMANDS,
  newId,
  ok,
  unwrap,
  type AnyTool,
  type CommandOrigin,
  type CommandToolContext,
  type GraphicItem,
  type Id,
  type Timeline,
} from '@taalcut/core';
import { compositionToolModule } from '../../src/compositions/tools';
import { workspaceWorld } from '../workspace/tools/support';
import { spokenTimeline } from './support';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const agent: CommandOrigin = { source: 'agent', actor: 'agent:run' };

const graphicsOf = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item) => item.type === 'graphic') : [],
  ) as GraphicItem[];

/** A timeline with one bubble placed as a proposal through the workspace tools, and the graphics tools over it. */
async function placedBubble() {
  const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
  const world = workspaceWorld(timeline);
  const html = await readFile(
    join(import.meta.dirname, '..', 'workspace', 'tools', 'fixtures', 'bubble.html'),
    'utf8',
  );
  unwrap(
    await world.call('workspace.write', {
      projectId: world.projectId,
      path: 'bubble/index.html',
      text: html,
    }),
  );
  const placed = unwrap(
    await world.call('workspace.place', {
      projectId: world.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      entry: 'bubble/index.html',
      name: 'Chat </untrusted> bubble',
      request: 'a bubble',
      at: 0.4,
    }),
  ) as { itemIds: Id<'TimelineItem'>[] };
  const latest = async () => unwrap(await world.store.get(timeline.id));
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  const module = compositionToolModule({ timelines: world.store });
  const tool = (name: string): AnyTool => {
    const found = module.tools.find((entry) => entry.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  async function run(name: string, input: unknown) {
    const spec = tool(name);
    const ctx: CommandToolContext = {
      signal: new AbortController().signal,
      callId: newId<'ToolRun'>(),
      runId: newId<'AgentRun'>(),
      attempt: 1,
      artifacts: world.artifacts,
      reportUsage: () => undefined,
      reportProgress: () => undefined,
      dispatch: async (payload) => {
        const done = await world.bus.dispatch(spec.command ?? name, payload, agent);
        return done.ok ? ok(done.value.result) : done;
      },
    };
    return spec.run(spec.input.parse(input), ctx as never);
  }
  return { world, itemId: placed.itemIds[0]!, latest, target, module, run };
}

describe('the graphics commands and tools on compositions', () => {
  it('offers list, edit, remove, design and proposal application', async () => {
    const { module } = await placedBubble();
    expect(module.id).toBe('graphics');
    expect(module.tools.map((tool) => tool.name)).toEqual([
      'graphics.list',
      GRAPHICS_COMMANDS.edit,
      GRAPHICS_COMMANDS.remove,
      'graphics.design',
      GRAPHICS_COMMANDS.useProposal,
    ]);
    expect(module.tools.slice(0, 3).map((tool) => tool.version)).toEqual(['2.0.0', '2.0.0', '2.0.0']);
  });

  it('lists a graphic’s design with its variables and values, its name defused, and that it is a proposal', async () => {
    const { run, itemId, target } = await placedBubble();
    const listed = unwrap(await run('graphics.list', { timelineId: target.timelineId })) as {
      items: {
        itemId: string;
        composition: { name: string; variables: { name: string }[]; params: object };
        proposal?: object;
      }[];
    };
    expect(listed.items).toHaveLength(1);
    const [item] = listed.items;
    expect(item?.itemId).toBe(itemId);
    expect(item?.composition.name).toBe('Chat ‹/untrusted> bubble');
    expect(item?.composition.variables.map((variable) => variable.name)).toEqual(['message', 'fill']);
    expect(item?.proposal).toEqual({ design: 'designed' });
  });

  it('Use it makes a proposal part of the video, once; undo makes it a proposal again', async () => {
    const { world, itemId, latest, target } = await placedBubble();
    const before = await latest();
    unwrap(
      await world.bus.dispatch(
        GRAPHICS_COMMANDS.useProposal,
        { ...target, revision: before.revision, itemId },
        ui,
      ),
    );
    const used = await latest();
    expect(graphicsOf(used)[0]?.proposal).toBeUndefined();
    const again = await world.bus.dispatch(GRAPHICS_COMMANDS.useProposal, { ...target, itemId }, ui);
    expect(again.ok ? '' : again.error.code).toBe('render.graphic_invalid');
    unwrap(await world.bus.undo(used.projectId, ui));
    expect(graphicsOf(await latest())[0]?.proposal?.request).toBe('a bubble');
  });

  it('removes a graphic, and undo puts it back; a graphic not on the timeline is not found', async () => {
    const { world, itemId, latest, target } = await placedBubble();
    unwrap(await world.bus.dispatch(GRAPHICS_COMMANDS.remove, { ...target, itemId }, ui));
    expect(graphicsOf(await latest())).toEqual([]);
    unwrap(await world.bus.undo(target.projectId, ui));
    expect(graphicsOf(await latest()).map((item) => item.id)).toEqual([itemId]);
    const missing = await world.bus.dispatch(
      GRAPHICS_COMMANDS.remove,
      { ...target, itemId: newId<'TimelineItem'>() },
      ui,
    );
    expect(missing.ok ? '' : missing.error.code).toBe('core.not_found');
  });

  it('graphics.edit rewords through its tool, and refuses a move, a place or a size: those are graphics.design', async () => {
    const { run, itemId, latest, target } = await placedBubble();
    const at = async () => ({ ...target, revision: (await latest()).revision, itemId });
    const reworded = await run(GRAPHICS_COMMANDS.edit, {
      ...(await at()),
      params: { message: 'Lake at noon?' },
    });
    expect(reworded.ok).toBe(true);
    expect(graphicsOf(await latest())[0]?.composition.params).toMatchObject({ message: 'Lake at noon?' });
    for (const refused of [
      { move: { direction: 'up', amount: 'little' } },
      { placement: 'top' },
      { resize: 'smaller' },
      { scale: 0.8 },
    ]) {
      const done = await run(GRAPHICS_COMMANDS.edit, { ...(await at()), ...refused });
      expect(done.ok ? '' : done.error.detail, JSON.stringify(refused)).toContain('graphics.design');
    }
  });
});
