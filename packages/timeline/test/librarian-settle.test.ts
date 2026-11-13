// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Librarian's step settled from its stored timelines: what the installed 0.1.0-beta.1 run needed after the 4B
 * assembled the video and handed off the cast's id.
 */
import { newId, ok, type SkillContext } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { librarianSettler } from '../src/skills/librarian-settle';
import { timelineSkillModule } from '../src/skills/skills';
import { agentWorld } from './fixtures/agent';

const signalled = (world: ReturnType<typeof agentWorld>): SkillContext => ({
  runId: newId<'AgentRun'>(),
  projectId: world.projectId,
  flowId: null,
  stepId: 's1',
  signal: new AbortController().signal,
});

/** Cast and assemble through the real tools, kept as the agent hands a step's completed calls to a settler. */
async function assembled(world: ReturnType<typeof agentWorld>, variants = 1) {
  const input = { projectId: world.projectId, template: { id: world.template.id }, variants, seed: 7 };
  const calls: { tool: string; input: unknown; output: unknown }[] = [];
  for (const tool of ['timeline.cast', 'timeline.assemble']) {
    const result = await world.call(tool, input);
    if (!result.ok) throw new Error(`${tool}: ${result.error.code}`);
    calls.push({ tool, input, output: result.value });
  }
  return calls;
}

describe('the Librarian settled from its stored timelines', () => {
  it('hands off the last assembly as stored, and the skill’s own check passes it', async () => {
    const world = agentWorld();
    const librarian = timelineSkillModule({ service: world.service, templates: world.templates }).skills[0]!;
    const calls = await assembled(world, 2);
    const output = calls[1]!.output as { timelineIds: string[]; revisions: number[]; lowConfidence: number };
    const settled = await librarianSettler({ service: world.service })(calls);
    expect(settled).toEqual(
      ok({
        templateId: world.template.id,
        timelineIds: output.timelineIds,
        revisions: output.revisions,
        lowConfidenceSlots: output.lowConfidence,
        reranked: 0,
      }),
    );
    const parsed = librarian.output.parse(settled.ok && settled.value);
    expect(await librarian.verify!(parsed, signalled(world))).toEqual(ok({ verdict: 'pass' }));
    // What the 4B handed off instead: the cast's id where the timeline's belongs.
    const castId = (calls[0]!.output as { castId: string }).castId;
    const wrong = await librarian.verify!(
      { ...parsed, timelineIds: [castId], revisions: [1] },
      signalled(world),
    );
    expect(wrong.ok && wrong.value).toMatchObject({ verdict: 'retry' });
  });

  it('reads the stored revision and counts, not what the call said at the time', async () => {
    const world = agentWorld();
    const calls = await assembled(world);
    const [timelineId] = (calls[1]!.output as { timelineIds: string[] }).timelineIds;
    const stale = { ...(calls[1]!.output as object), revisions: [41], lowConfidence: 99 };
    const settled = await librarianSettler({ service: world.service })([
      calls[0]!,
      { ...calls[1]!, output: stale },
    ]);
    const stored = await world.service.read(timelineId as never);
    expect(stored.ok && settled.ok && settled.value).toMatchObject({
      timelineIds: [timelineId],
      revisions: [stored.ok ? stored.value.revision : 0],
      lowConfidenceSlots: stored.ok ? stored.value.cast!.slots.filter((slot) => slot.needsRerank).length : -1,
    });
  });

  it('settles nothing when the step assembled nothing or a timeline cannot be read', async () => {
    const world = agentWorld();
    const settle = librarianSettler({ service: world.service });
    const calls = await assembled(world);
    expect(await settle([calls[0]!])).toEqual(ok(undefined));
    expect(await settle([])).toEqual(ok(undefined));
    // A result stored aside reaches the settler without its value.
    expect(await settle([calls[0]!, { ...calls[1]!, output: undefined }])).toEqual(ok(undefined));
    const unknown = { ...calls[1]!, output: { timelineIds: [newId<'Timeline'>()] } };
    expect(await settle([calls[0]!, unknown])).toEqual(ok(undefined));
  });
});
