// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Designer (HFW1 dsn): a valid skill over workspace, graphics and timeline tools, its limits and prompt, and its
 * check: every job ends placed (graphics the timeline holds), replaced (each graphic it names), or notDone with a
 * reason, at the timeline's revision. DSG2: placed and replaced are in the video with three designs to choose
 * between, or the result says why there are fewer; a graphic left as a proposal is sent back. Also the composition
 * commands' edits: words and time, never place or size.
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

type PlacedIds = { itemIds: Id<'TimelineItem'>[]; compositionId: Id<'GraphicComposition'> };
const TITLES = ['title-a', 'title-b', 'title-c'];

/** A timeline with one placed bubble, a proposal, made through the tools. */
async function placedBubble() {
  const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
  const world = workspaceWorld(timeline);
  value(await world.call('workspace.write', { projectId: world.projectId, path: 'bubble/index.html', text: await fixture('bubble.html') }));
  const placed = value<PlacedIds>(
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

/** A timeline with a job's title placed as `count` designs (DSG2), made through the tools. */
async function placedTitle(count = 3) {
  const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
  const world = workspaceWorld(timeline);
  for (const name of TITLES)
    value(await world.call('workspace.write', { projectId: world.projectId, path: `${name}/index.html`, text: await fixture(`${name}.html`) }));
  const placed = value<PlacedIds>(
    await world.call('workspace.placeOptions', {
      projectId: world.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      options: TITLES.slice(0, count).map((name, at) => ({ entry: `${name}/index.html`, name: `Title ${at + 1}`, idea: `Idea ${at + 1}` })),
      request: 'a title',
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
    // DSG2: a job ends with workspace.placeOptions; a lone proposal (workspace.place) is not the Designer's.
    expect(skill.tools.names).toContain('workspace.placeOptions');
    expect(skill.tools.names).not.toContain('workspace.place');
    expect(skill.tools.names).toEqual([
      ...WORKSPACE_TOOLS.map((name) => (name === 'workspace.place' ? 'workspace.placeOptions' : name)),
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
    expect(DESIGNER_PROMPT).toContain('designer/3');
    for (const rule of ['_taalcut/brief.md', "addLabel('exit'", 'data-var-text', 'assets/<sha256>', 'safe rect', 'faces'])
      expect(DESIGNER_PROMPT).toContain(rule);
    // DSG2: up to three options a job placed one at a time, the method's guide, and the reason for fewer.
    for (const rule of ['workspace.placeOptions', 'taalcut/design-options', 'fewerBecause', 'never one design recoloured', 'Finish and place one design before starting the next', 'Never rewrite a placed design'])
      expect(DESIGNER_PROMPT).toContain(rule);
    // No kit to fall back on, in the prompt either.
    expect(DESIGNER_PROMPT).not.toMatch(/lowerThird|chatBubble|graphics\.create|graphics\.add/);
    const module = createRenderSkillModule({ store: { get: async () => { throw new Error('unused'); } }, designer: { timelines: { get: async () => { throw new Error('unused'); } } } });
    expect(skillModuleProblems(module)).toEqual([]);
    expect(module.skills.map((entry) => entry.id)).toEqual(['render.reviewer', 'render.designer']);
    expect(createRenderSkillModule({ store: { get: async () => { throw new Error('unused'); } } }).skills).toHaveLength(1);
  });

  it('checks every job ended placed, replaced or with a reason, on the timeline as it is', async () => {
    const { timeline, placed } = await placedTitle();
    const input = designerInputSchema.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      jobs: [
        { jobId: 'a', request: 'a title', at: 0.4 },
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
      reason: expect.stringContaining('workspace.placeOptions with those itemIds'),
    });
  });

  it('wants three designs a job in the video, or the reason there are fewer (DSG2)', async () => {
    const job = (timeline: Timeline) =>
      designerInputSchema.parse({ projectId: timeline.projectId, timelineId: timeline.id, jobs: [{ jobId: 'a', request: 'a title', at: 0.4 }] });
    const result = (placed: PlacedIds) => ({ jobId: 'a', outcome: 'placed' as const, itemIds: placed.itemIds, compositionId: placed.compositionId });
    const handoff = (timeline: Timeline, results: object[]) => ({ timelineId: timeline.id, revision: timeline.revision, results }) as never;
    const three = await placedTitle();
    expect(checkDesigns(handoff(three.timeline, [result(three.placed)]), job(three.timeline), three.timeline)).toEqual({ verdict: 'pass' });
    const two = await placedTitle(2);
    expect(checkDesigns(handoff(two.timeline, [result(two.placed)]), job(two.timeline), two.timeline)).toMatchObject({
      verdict: 'retry',
      reason: expect.stringContaining('ended with 2 of 3 designs'),
    });
    expect(
      checkDesigns(handoff(two.timeline, [{ ...result(two.placed), fewerBecause: 'The third kept failing the gate.' }]), job(two.timeline), two.timeline),
    ).toEqual({ verdict: 'pass' });
    const one = await placedTitle(1);
    expect(checkDesigns(handoff(one.timeline, [result(one.placed)]), job(one.timeline), one.timeline)).toMatchObject({
      reason: expect.stringContaining('ended with 1 of 3 designs'),
    });
    // A graphic left waiting as a proposal is not a finished job, with a reason or without.
    const proposed = await placedBubble();
    expect(
      checkDesigns(handoff(proposed.timeline, [{ ...result(proposed.placed), fewerBecause: 'One was asked for.' }]), job(proposed.timeline), proposed.timeline),
    ).toMatchObject({ verdict: 'retry', reason: expect.stringContaining('still a proposal') });
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
