// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-V16's tools: full metadata, JSON Schema-safe, and each run through the bus as the agent. */
import {
  defineToolModule,
  toolModuleProblems,
  toolSummary,
  type AnyTool,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { styleTools } from '../../src/tools/style-tools';
import { commandWorld, ui } from '../fixtures/command-world';
import { BRAND_CAPTIONS, makeStyle, memoryStyles, withCaptions } from '../fixtures/styles';
import { agentToolContext } from '../fixtures/tool-context';
import { buildTimeline } from '../fixtures/timeline';

const TARGETS = ['draft-2020-12', 'draft-07', 'openapi-3.0'] as const;

function converts(schema: z.ZodType, io: 'input' | 'output'): boolean {
  for (const target of TARGETS) z.toJSONSchema(schema, { target, io, unrepresentable: 'throw' });
  return true;
}

function tool(name: string): AnyTool {
  const found = styleTools().find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No tool ${name}`);
  return found;
}

/** Validates the input as the registry would, runs the tool, and validates its output. */
async function call(world: ReturnType<typeof commandWorld>, name: string, input: unknown) {
  const chosen = tool(name);
  const result = await chosen.run(chosen.input.parse(input), agentToolContext(world.bus, chosen));
  return result.ok ? { ok: true as const, value: chosen.output.parse(result.value) } : result;
}

const video = (): Timeline =>
  withCaptions(buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }] }).timeline);

describe('style tools', () => {
  it('declare full metadata and convert to JSON Schema', () => {
    const module = defineToolModule({ id: 'timeline', tools: styleTools() });
    expect(toolModuleProblems(module)).toEqual([]);
    expect(module.tools.map((entry) => entry.name)).toEqual([
      'timeline.setStyle',
      'timeline.applyStyleToMany',
    ]);
    for (const entry of module.tools) {
      expect(toolSummary(entry).length).toBeLessThanOrEqual(120);
      expect(converts(entry.input, 'input') && converts(entry.output, 'output')).toBe(true);
    }
    expect(tool('timeline.applyStyleToMany')).toMatchObject({
      command: 'batch.applyStyle',
      timeoutMs: 60_000,
    });
  });

  it('timeline.setStyle gives one video a Style as the agent, undoably', async () => {
    const style = makeStyle(BRAND_CAPTIONS);
    const world = commandWorld({ styles: memoryStyles([style]) });
    const timeline = video();
    await world.seed(timeline);
    const done = await call(world, 'timeline.setStyle', {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      styleId: style.id,
    });
    expect(done.ok && done.value).toMatchObject({ timelineId: timeline.id, revision: 2 });
    expect(world.doc(timeline.id).styleId).toBe(style.id);
    expect((await world.bus.undo(timeline.projectId, ui)).ok).toBe(true);
    expect(world.doc(timeline.id).styleId).toBeNull();
  });

  it('timeline.applyStyleToMany runs batch.applyStyle once for every video', async () => {
    const world = commandWorld();
    const timelines = [video(), video(), buildTimeline({ clips: [{ frames: 30 }] }).timeline];
    await world.seed(...timelines);
    const done = await call(world, 'timeline.applyStyleToMany', {
      items: timelines.map((timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id })),
      apply: { kind: 'captionPreset', presetId: 'karaoke' },
    });
    expect(done.ok && done.value).toMatchObject({
      applied: [timelines[0]?.id, timelines[1]?.id],
      skipped: [{ timelineId: timelines[2]?.id, reason: 'noCaptions' }],
    });
    expect(await world.bus.history(null)).toMatchObject({ value: { undo: 'batch.applyStyle' } });
  });
});
