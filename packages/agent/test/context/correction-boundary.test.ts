// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Corrections must name usable tools, including families and excluding input-withheld alternatives. */
import {
  defineSkill,
  defineSkillModule,
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  ok,
  unwrap,
} from '@taalcut/core';
import { createSkillRegistry } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { call, harness, ofType, registryFor, turns } from '../support/harness';

const output = z.object({ templateId: z.string(), timelineIds: z.array(z.string()) });
const tool = (name: string, result: z.ZodObject) =>
  defineTool({
    name,
    version: '1.0.0',
    description: `Returns the ${name} result.`,
    input: z.object({}),
    output: result,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    run: async () => ok({ templateId: 'template', timelineIds: ['timeline'] }),
  });

async function corrected(namedOnly: boolean, plannerCoversHandoff = false) {
  const modules = [
    defineToolModule({ id: 'timeline', tools: [tool('timeline.assemble', output)] }),
    defineToolModule({
      id: 'templates',
      tools: [
        tool(
          'templates.planFromFormat',
          plannerCoversHandoff ? output : z.object({ templateId: z.string() }),
        ),
        tool('templates.breakdown', output),
      ],
    }),
  ];
  const skill = defineSkill({
    id: namedOnly ? 'templates.analyst' : 'timeline.librarian',
    version: '1.0.0',
    labelKey: 'skills.test',
    description: 'Makes the requested template or timeline.',
    prompt: 'Use the tools, then hand off their result.',
    tools: namedOnly
      ? { names: ['templates.breakdown'] }
      : { families: ['timeline'], names: ['templates.planFromFormat'] },
    input: z.object({ templateId: z.string() }),
    withheldTools: (input) => (input.templateId ? ['templates.planFromFormat'] : []),
    output,
    refs: () => [],
  });
  const skills = unwrap(
    createSkillRegistry(
      [defineSkillModule({ id: namedOnly ? 'templates' : 'timeline', skills: [skill] })],
      registryFor(modules),
    ),
  );
  const h = harness({
    modules,
    deps: { skills },
    script: turns(
      {
        toolCalls: [
          call('updatePlan', {
            steps: [{ text: 'Make the reel', skill: skill.id, input: { templateId: 'given-template' } }],
          }),
        ],
      },
      { text: 'I have not made it yet.' },
    ),
  });
  const run = unwrap(await h.agent.run({ conversationId: 'c', message: 'Make this reel.' }));
  expect(run.status).toBe('failed');
  const notes = ofType(await h.events(run.runId), 'step.corrected');
  expect(notes).toHaveLength(1);
  return notes[0]!.payload;
}

describe('correction tool boundary', () => {
  it('names the Librarian family tool and never a withheld replacement planner', async () => {
    const note = await corrected(false);
    expect(note.tools).toEqual(['timeline.assemble']);
    expect(note.text).toContain('timeline.assemble');
    expect(note.text).toContain("If the tool's schema is not offered, load it with findTools first.");
    expect(note.text).not.toContain('templates.planFromFormat');
    expect(note.text).not.toContain('templates.breakdown');
  });

  it('still names the Analyst tool when its skill declares only names', async () => {
    const note = await corrected(true);
    expect(note.tools).toEqual(['templates.breakdown']);
    expect(note.text).not.toContain('timeline.assemble');
  });

  it('excludes a withheld tool even when its output covers every missing field', async () => {
    const note = await corrected(false, true);
    expect(note.tools).toEqual(['timeline.assemble']);
    expect(note.text).not.toContain('templates.planFromFormat');
  });
});
