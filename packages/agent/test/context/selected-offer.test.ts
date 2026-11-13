// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A large selected schema must never force an action or hide control recovery. */
import {
  defineSkill,
  defineSkillModule,
  defineTool,
  defineToolModule,
  err,
  NO_TOOL_RETRY,
  ok,
  unwrap,
} from '@taalcut/core';
import { createSkillRegistry, DEFAULT_LOOP_SETTINGS, foldEvents } from '@taalcut/agent';
import { createMemoryArtifactStore } from '@taalcut/tools';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { call, harness, ofType, registryFor, SOUL } from '../support/harness';
import { fitPrompt } from '../../src/context/fit';
import { turnContext } from '../../src/turn-context';
import type { RunContext } from '../../src/context';

function setup(fail: boolean, questions = false) {
  const base = {
    version: '1.0.0',
    output: z.object({ done: z.boolean() }),
    costClass: 'local' as const,
    sideEffect: 'read' as const,
    timeoutMs: 1000,
    retry: NO_TOOL_RETRY,
  };
  const modules = [
    defineToolModule({
      id: 'choice',
      tools: [
        defineTool({
          ...base,
          name: 'choice.read',
          description: 'Read the project.',
          input: z.object({}),
          run: async () => ok({ done: true }),
        }),
        defineTool({
          ...base,
          name: 'choice.large',
          description: 'Apply the requested design.',
          input: z.object({
            note: z.string().describe('Keep the material and the requested timing together. '.repeat(330)),
          }),
          run: async () =>
            fail
              ? err({
                  code: 'tools.invalid_input',
                  messageKey: 'errors.tools.invalid_input',
                  retryable: false,
                })
              : ok({ done: true }),
        }),
      ],
    }),
  ];
  const registry = registryFor(modules);
  const skill = defineSkill({
    id: 'choice.work',
    version: '1.0.0',
    labelKey: 'skills.test',
    description: 'Read the project with choice.read, then follow the request.',
    prompt: 'Preserve the request and project. Apply only chosen changes.',
    tools: { families: ['choice'] },
    ...(questions ? { questions: ['variants'] as const } : {}),
    input: z.object({ project: z.string() }),
    output: z.object({ done: z.boolean() }),
    refs: () => [],
  });
  const skills = unwrap(
    createSkillRegistry([defineSkillModule({ id: 'choice', skills: [skill] })], registry),
  );
  return { modules, skills };
}

it.each([
  'execute',
  'failure',
  'handOff',
  'readArtifact',
  'updatePlan',
  'handOff readArtifact',
  'handOff.',
  '"handOff"',
  'askUser',
] as const)('keeps a control exit from the selected schema: %s', async (mode) => {
  const fixture = setup(mode === 'failure', mode === 'askUser');
  const artifacts = createMemoryArtifactStore();
  const ref = unwrap(
    await artifacts.put({ mediaType: 'application/json', data: '{"word":"kept"}', summary: 'fixture' }),
  );
  let skillTurn = 0;
  let selected = false;
  const h = harness({
    modules: fixture.modules,
    deps: { skills: fixture.skills, artifacts, contextWindow: () => 12_288 },
    script: (request, turn) => {
      if (!request.system?.includes('# Skill: choice.work'))
        return turn === 0
          ? {
              toolCalls: [
                call('updatePlan', {
                  steps: [
                    {
                      text: 'Read then apply the chosen design.',
                      skill: 'choice.work',
                      input: { project: 'keep-project' },
                    },
                  ],
                }),
              ],
            }
          : { text: 'Finished.' };
      const at = skillTurn++;
      if (at === 0) return { toolCalls: [call('findTools', { query: 'choice.large' })] };
      if (at === 1) {
        expect(request.tools?.map((t) => t.name)).toEqual(['findTools', 'choice_large']);
        expect(request.system).toContain('You need not perform the action');
        selected = true;
        return {
          toolCalls: [
            mode === 'execute' || mode === 'failure'
              ? call('choice_large', { note: 'Keep the selected footage.' })
              : call('findTools', { query: mode }),
          ],
        };
      }
      expect(request.tools?.some((t) => t.name === 'handOff')).toBe(true);
      if (at === 2 && mode === 'askUser') expect(request.tools?.some((t) => t.name === 'askUser')).toBe(true);
      if (at === 2 && mode === 'readArtifact') {
        expect(request.tools?.some((t) => t.name === 'readArtifact')).toBe(true);
        return { toolCalls: [call('readArtifact', { id: ref.id, path: '/word' })] };
      }
      if (at === 2 && mode === 'updatePlan') {
        expect(request.tools?.some((t) => t.name === 'updatePlan')).toBe(true);
        return { toolCalls: [call('updatePlan', { steps: [{ text: 'Keep the chosen design.' }] })] };
      }
      return { toolCalls: [call('handOff', { done: mode === 'execute' })] };
    },
  });
  const result = unwrap(
    await h.agent.run({
      conversationId: mode,
      message: 'Only apply my chosen design; keep my other footage.',
    }),
  );
  expect(result.status).toBe('completed');
  expect(selected).toBe(true);
  const events = await h.events(result.runId);
  if (mode === 'execute') {
    const narrow = ofType(events, 'model.requested').find(
      (e) => e.payload.toolNames.length === 2 && e.payload.toolNames.includes('choice_large'),
    )!;
    const state = foldEvents(
      result.runId,
      events.filter((e) => e.seq <= narrow.seq),
    );
    state.inputChanges.push({
      seq: narrow.seq + 1,
      commandId: 'user-change',
      stepIds: ['s1'],
      refs: [],
      applied: false,
    });
    const ctx = {
      log: { state },
      registry: h.registry,
      skills: fixture.skills,
      soul: SOUL,
      settings: DEFAULT_LOOP_SETTINGS,
      contextWindow: () => 12_288,
      phase2: {},
      phase3: {},
      systemPrompt: '',
    } as unknown as RunContext;
    const fit = fitPrompt(ctx, turnContext(ctx, 'act'), 'changed-input');
    expect(fit.error).toBeUndefined();
    expect(fit.turn.tools.map((t) => t.name)).toContain('updatePlan');
    expect(fit.turn.tools.map((t) => t.name)).not.toContain('choice_large');
  }
  const domain = ofType(events, 'tool.requested').filter((e) => e.payload.tool === 'choice.large');
  expect(domain).toHaveLength(['execute', 'failure'].includes(mode) ? 1 : 0);
  if (mode === 'failure')
    expect(ofType(events, 'tool.failed').at(-1)?.payload.error.code).toBe('tools.invalid_input');
  for (const event of ofType(events, 'context.compacted')) {
    expect(event.payload.fits).toBe(true);
    expect(event.payload.afterTokens).toBeLessThanOrEqual(6963);
  }
  expect(unwrap(await h.agent.replay(result.runId)).promptDrift).toBe(0);
});
