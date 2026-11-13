// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A step no extension added, settled from what is stored when its model's handoff never passes (BRK1-MAKE's
 * settle, for a skill the composition names a settler for). 0.1.0-beta.1's installed run: the 4B assembled the
 * video, then handed off the cast's id where the timeline's belongs, and the make failed with the video made.
 */
import {
  defineSkill,
  defineSkillModule,
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  ok,
  unwrap,
} from '@taalcut/core';
import { createSkillRegistry, type SettlerCall, type StepSettler } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { call, harness, ofType, registryFor, turns, type HarnessOptions } from '../support/harness';

const SKILL = 'settle.work';

function fixture() {
  const make = defineTool({
    name: 'settle.make',
    version: '1.0.0',
    description: 'Makes the video and returns its id.',
    input: z.object({ note: z.string() }),
    output: z.object({ made: z.string(), draft: z.string() }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    run: async () => ok({ made: 'the-video', draft: 'a-draft' }),
  });
  const modules = [defineToolModule({ id: 'settle', tools: [make] })];
  const skill = defineSkill({
    id: SKILL,
    version: '1.0.0',
    labelKey: 'skills.test',
    description: 'Use settle.make to make the video.',
    prompt: 'Make the video, then hand off the id it returned.',
    tools: { families: ['settle'] },
    input: z.object({ project: z.string() }),
    output: z.object({ made: z.string() }),
    refs: () => [],
    verify: async (output) =>
      ok(
        output.made === 'the-video'
          ? { verdict: 'pass' as const }
          : { verdict: 'retry' as const, reason: `No video has the id ${output.made}.` },
      ),
  });
  const skills = unwrap(
    createSkillRegistry([defineSkillModule({ id: 'settle', skills: [skill] })], registryFor(modules)),
  );
  return { modules, skills };
}

/** What the composition gives: the handoff as stored, read from the step's completed calls. */
const settler =
  (seen: SettlerCall[][] = []): StepSettler =>
  async (calls) => {
    seen.push([...calls]);
    const made = calls.findLast((made) => made.tool === 'settle.make')?.output as
      { made?: string } | undefined;
    return ok(made?.made ? { made: made.made } : undefined);
  };

const plan = {
  toolCalls: [call('updatePlan', { steps: [{ text: 'Work', skill: SKILL, input: { project: 'p' } }] })],
};
const makes = { toolCalls: [call('settle_make', { note: 'Make it.' })] };
/** The 4B's handoff: an id a tool returned, but not the video's. */
const wrong = { toolCalls: [call('handOff', { made: 'a-draft' })] };

function run(script: HarnessOptions['script'], settlers?: Record<string, StepSettler>) {
  const setup = fixture();
  return harness({
    modules: setup.modules,
    deps: {
      skills: setup.skills,
      ...(settlers ? { phase3: { flowExtensions: { extensions: [], settlers } } } : {}),
    },
    script,
  });
}

describe('a step settled by its skill’s settler', () => {
  it('hands off what is stored after the model’s handoff failed its last check, and the run goes on', async () => {
    const seen: SettlerCall[][] = [];
    const h = run(turns(plan, makes, wrong, wrong, wrong, { text: 'Done.' }), { [SKILL]: settler(seen) });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Make it.' }));
    const events = await h.events(outcome.runId);
    expect(outcome.status, JSON.stringify(ofType(events, 'run.failed'))).toBe('completed');
    expect(ofType(events, 'skill.verified').map((event) => event.payload.verdict)).toEqual([
      'retry',
      'retry',
      'retry',
      'pass',
    ]);
    expect(ofType(events, 'skill.handedOff').at(-1)?.payload).toMatchObject({
      skill: SKILL,
      settled: true,
      output: { made: 'the-video' },
    });
    // The settler is asked once, with the step's completed domain calls and what they returned.
    expect(seen).toEqual([
      [{ tool: 'settle.make', input: { note: 'Make it.' }, output: { made: 'the-video', draft: 'a-draft' } }],
    ]);
    // A replay reads the logged settlement instead of settling again.
    expect(unwrap(await h.agent.replay(outcome.runId))).toMatchObject({
      status: 'completed',
      promptDrift: 0,
    });
    expect(seen).toHaveLength(1);
  });

  it('settles a step that made the video and then only answered in words', async () => {
    const h = run(turns(plan, makes, { text: 'The video is made.' }), { [SKILL]: settler() });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Make it.' }));
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'run.failed')).toEqual([]);
    expect(ofType(events, 'skill.handedOff').at(-1)?.payload).toMatchObject({
      settled: true,
      output: { made: 'the-video' },
    });
  });

  it('fails as before when nothing is stored to hand off, or no settler was given', async () => {
    const nothingMade = run(turns(plan, wrong, wrong, wrong), { [SKILL]: settler() });
    const first = unwrap(await nothingMade.agent.run({ conversationId: 'c', message: 'Make it.' }));
    expect(first.status).toBe('failed');
    expect(ofType(await nothingMade.events(first.runId), 'run.failed')[0]?.payload.error).toMatchObject({
      code: 'agent.verify_failed',
      detail: 'No video has the id a-draft.',
    });
    const noSettler = run(turns(plan, makes, wrong, wrong, wrong));
    const second = unwrap(await noSettler.agent.run({ conversationId: 'c', message: 'Make it.' }));
    expect(second.status).toBe('failed');
    expect(ofType(await noSettler.events(second.runId), 'skill.handedOff')).toEqual([]);
  });

  it('holds the settled handoff to the skill’s check', async () => {
    const lying: StepSettler = async () => ok({ made: 'not-stored' });
    const h = run(turns(plan, makes, wrong, wrong, wrong), { [SKILL]: lying });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Make it.' }));
    expect(outcome.status).toBe('failed');
    expect(ofType(await h.events(outcome.runId), 'skill.handedOff')).toEqual([]);
  });
});
