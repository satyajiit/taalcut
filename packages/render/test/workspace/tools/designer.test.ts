// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Designer (HFW1 dsn): a valid skill over workspace, graphics and timeline tools, its limits and prompt, and its
 * check: every job ends placed (a proposal the timeline holds), replaced (each graphic it names), or notDone with a
 * reason, at the timeline's revision. Also the composition commands' edits: words and time, never place or size.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  newId,
  skillModuleProblems,
  skillSpecProblems,
  type GraphicItem,
  type Id,
  type Timeline,
} from '@taalcut/core';
import { checkDesigns, designerInputSchema } from '../../../src/skills/designer-checks';
import { designerSkill, DESIGNER_EXTRA_TOOLS, DESIGNER_TOOLS } from '../../../src/skills/designer';
import { DESIGNER_PROMPT } from '../../../src/skills/designer-prompt';
import { createRenderSkillModule } from '../../../src/skills/reviewer';
import { WORKSPACE_TOOLS } from '../../../src/workspace/tools/module';
import { spokenTimeline } from '../../compositions/support';
import { workspaceWorld } from './support';

const fixture = (name: string) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');
const value = <T>(result: { ok: boolean; value?: unknown; error?: unknown }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value as T;
};
const graphicsOf = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) =>
    track.kind === 'text' ? track.items.filter((item) => item.type === 'graphic') : [],
  ) as GraphicItem[];

/** A timeline with one placed bubble, made through the tools. */
async function placedBubble() {
  const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
  const world = workspaceWorld(timeline);
  value(await world.call('workspace.write', { projectId: world.projectId, path: 'bubble/index.html', text: await fixture('bubble.html') }));
  const placed = value<{ itemIds: Id<'TimelineItem'>[]; compositionId: Id<'GraphicComposition'> }>(
    await world.call('workspace.place', {
      projectId: world.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      entry: 'bubble/index.html',
      name: 'Chat bubble',
      request: 'a bubble',
      at: 0.4,
    }),
  );
  const after = value<Timeline>(await world.store.get(timeline.id));
  return { world, timeline: after, placed };
}

describe('the Designer', () => {
  it('is a valid skill over the workspace tools, at 10 turns expected and 30 at most', () => {
    const skill = designerSkill({ timelines: { get: async () => { throw new Error('unused'); } } });
    expect(skillSpecProblems(skill as never)).toEqual([]);
    expect(skill.tools.names).toEqual([
      ...WORKSPACE_TOOLS,
      'graphics.list',
      'graphics.edit',
      'graphics.remove',
      'timeline.get',
      'timeline.captureFrame',
      'comments.reply',
    ]);
    const extended = designerSkill({ timelines: { get: async () => { throw new Error('unused'); } }, registered: () => true });
    expect(extended.tools.names).toEqual([...DESIGNER_TOOLS, ...DESIGNER_EXTRA_TOOLS]);
    expect(DESIGNER_EXTRA_TOOLS).toEqual(
      expect.arrayContaining([
        'workspace.open',
        'workspace.exec',
        'workspace.importMedia',
        'templates.get',
        'templates.styleProfile',
        'vision.describeFrame',
        'video.compare',
        'memory.recall',
        'memory.remember',
        'timeline.insertClip',
        'timeline.swapClip',
      ]),
    );
    expect(DESIGNER_TOOLS).not.toContain('workspace.import');
    expect(skill.limits).toEqual({ expectedTurns: 10, maxTurns: 30 });
    expect(DESIGNER_PROMPT).toContain('designer/2');
    for (const rule of ['_taalcut/brief.md', "addLabel('exit'", 'data-var-text', 'assets/<sha256>', 'safe rect', 'faces'])
      expect(DESIGNER_PROMPT).toContain(rule);
    // No kit to fall back on, in the prompt either.
    expect(DESIGNER_PROMPT).not.toMatch(/lowerThird|chatBubble|graphics\.create|graphics\.add/);
    const module = createRenderSkillModule({ store: { get: async () => { throw new Error('unused'); } }, designer: { timelines: { get: async () => { throw new Error('unused'); } } } });
    expect(skillModuleProblems(module)).toEqual([]);
    expect(module.skills.map((entry) => entry.id)).toEqual(['render.reviewer', 'render.designer']);
    expect(createRenderSkillModule({ store: { get: async () => { throw new Error('unused'); } } }).skills).toHaveLength(1);
  });

  it('checks every job ended placed, replaced or with a reason, on the timeline as it is', async () => {
    const { timeline, placed } = await placedBubble();
    const input = designerInputSchema.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      jobs: [
        { jobId: 'a', request: 'a bubble', at: 0.4 },
        { jobId: 'b', request: 'a map pin with a route' },
      ],
    });
    const base = { timelineId: timeline.id, revision: timeline.revision };
    const placedResult = { jobId: 'a', outcome: 'placed' as const, itemIds: placed.itemIds, compositionId: placed.compositionId };
    expect(checkDesigns({ ...base, results: [placedResult] }, input, timeline)).toMatchObject({
      verdict: 'retry',
      reason: expect.stringContaining('No result for job b'),
    });
    expect(checkDesigns({ ...base, results: [placedResult, { jobId: 'b', outcome: 'notDone' }] }, input, timeline)).toMatchObject({
      verdict: 'retry',
      reason: expect.stringContaining('say why'),
    });
    expect(
      checkDesigns(
        { ...base, results: [placedResult, { jobId: 'b', outcome: 'notDone', reason: 'No route data in the video.' }] },
        input,
        timeline,
      ),
    ).toEqual({ verdict: 'pass' });
    const made = newId<'TimelineItem'>();
    expect(checkDesigns({ ...base, results: [{ ...placedResult, itemIds: [made] }] }, input, timeline).verdict).toBe('retry');
    expect(checkDesigns({ ...base, revision: timeline.revision + 1, results: [placedResult] }, input, timeline)).toMatchObject({
      reason: expect.stringContaining(`revision ${timeline.revision}`),
    });
    const redesign = designerInputSchema.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      jobs: [{ jobId: 'c', request: 'rounder', itemIds: [...placed.itemIds, made] }],
    });
    const replaced = { jobId: 'c', outcome: 'replaced' as const, itemIds: placed.itemIds };
    expect(checkDesigns({ ...base, results: [replaced] }, redesign, timeline)).toMatchObject({
      reason: expect.stringContaining(made),
    });
    // A redesign that placed another graphic is sent back to replace the ones it names.
    expect(checkDesigns({ ...base, results: [{ ...replaced, outcome: 'placed' }] }, redesign, timeline)).toMatchObject({
      verdict: 'retry',
      reason: expect.stringContaining('workspace.replace them with your entry'),
    });
  });

  it('edits a designed graphic’s words and time, and refuses moving or resizing it', async () => {
    const { world, timeline } = await placedBubble();
    const [graphic] = graphicsOf(timeline);
    const edit = (payload: Record<string, unknown>) =>
      world.bus.dispatch('graphics.edit', { projectId: timeline.projectId, timelineId: timeline.id, itemId: graphic!.id, ...payload }, { source: 'agent', actor: 'agent:run' });
    const reworded = await edit({ params: { message: 'Lake at noon?' } });
    expect(reworded.ok).toBe(true);
    const unknown = await edit({ params: { colour: '#ffffff' } });
    expect(unknown.ok ? '' : unknown.error.detail).toContain('no variable colour');
    const moved = await edit({ placement: 'top' });
    expect(moved.ok ? '' : moved.error.detail).toContain('graphics.design');
    const sized = await edit({ scale: 0.8 });
    expect(sized.ok ? '' : sized.error.detail).toContain('graphics.design');
    const latest = value<Timeline>(await world.store.get(timeline.id));
    expect(graphicsOf(latest)[0]?.composition.params).toEqual({ message: 'Lake at noon?' });
  });
});
