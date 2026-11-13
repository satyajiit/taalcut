// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Oversized tool schemas must leave room to answer, without hiding a later explicit tool search. */
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
import { createSkillRegistry } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMemoryArtifactStore } from '@taalcut/tools';
import { call, harness, ofType, registryFor, turns } from '../support/harness';

const window = 12_288;
const budget = 6_963;

function fixture(oversized = false) {
  const names = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'last'];
  const tools = names.map((name) =>
    defineTool({
      name: `budget.${name}`,
      version: '1.0.0',
      description: `Uses the ${name} part of the requested material.`,
      input: z.object({
        note: z
          .string()
          .describe('Keep the material and the requested timing together. '.repeat(oversized ? 2_000 : 100)),
      }),
      output: z.object({ done: z.boolean() }),
      costClass: 'local',
      sideEffect: 'read',
      timeoutMs: 1_000,
      retry: NO_TOOL_RETRY,
      run: async () => ok({ done: true }),
    }),
  );
  const modules = [defineToolModule({ id: 'budget', tools })];
  const skill = defineSkill({
    id: 'budget.work',
    version: '1.0.0',
    labelKey: 'skills.test',
    description: 'Use budget.first to start the work.',
    prompt: 'Keep the given project and material. Use the tools, then hand off.',
    tools: { families: ['budget'] },
    input: z.object({ project: z.string() }),
    output: z.object({ done: z.boolean() }),
    refs: () => [],
  });
  const skills = unwrap(
    createSkillRegistry([defineSkillModule({ id: 'budget', skills: [skill] })], registryFor(modules)),
  );
  return { modules, skills };
}

const plan = {
  toolCalls: [
    call('updatePlan', {
      steps: [{ text: 'Work', skill: 'budget.work', input: { project: 'keep-project' } }],
    }),
  ],
};

describe('a tool offer within the context budget', () => {
  it('does not treat a failed selected domain call as completed work', async () => {
    const setup = fixture(true);
    let narrowed = false;
    const h = harness({
      modules: setup.modules,
      deps: {
        skills: setup.skills,
        contextWindow: () => (narrowed ? window : 128_000),
        executor: {
          async execute() {
            narrowed = true;
            return err({
              code: 'tools.invalid_input',
              messageKey: 'errors.tools.invalid_input',
              retryable: false,
            });
          },
        },
      },
      script: turns(plan, { toolCalls: [call('budget_first', { note: 'Use the selected footage.' })] }),
    });
    const result = unwrap(
      await h.agent.run({ conversationId: 'failed-choice', message: 'Keep the selected tool.' }),
    );
    expect(result.status).toBe('failed');
    const events = await h.events(result.runId);
    expect(ofType(events, 'tool.failed').at(-1)?.payload.error.code).toBe('tools.invalid_input');
    expect(ofType(events, 'run.failed').at(-1)?.payload.error.code).toBe('models.context_too_long');
    expect(h.models.requests).toHaveLength(2);
  });
  it('does not hide an explicit tool search when it shares a batch with reading a page', async () => {
    const setup = fixture(true);
    const artifacts = createMemoryArtifactStore();
    const ref = unwrap(
      await artifacts.put({ mediaType: 'application/json', data: '{"data":"kept"}', summary: '' }),
    );
    let narrowed = false;
    const h = harness({
      modules: setup.modules,
      deps: { skills: setup.skills, artifacts, contextWindow: () => (narrowed ? window : 128_000) },
      script: (_request, turn) => {
        if (turn === 0) return plan;
        narrowed = true;
        return {
          toolCalls: [
            call('readArtifact', { id: ref.id, path: '/data' }),
            call('findTools', { query: 'budget.last' }),
          ],
        };
      },
    });
    const result = unwrap(await h.agent.run({ conversationId: 'mixed', message: 'Keep the selected tool.' }));
    expect(result.status).toBe('failed');
    const events = await h.events(result.runId);
    expect(ofType(events, 'run.failed').at(-1)?.payload.error.code).toBe('models.context_too_long');
    expect(h.models.requests).toHaveLength(2);
    expect(
      ofType(events, 'tool.completed').filter((event) => event.payload.loaded?.includes('budget.last')),
    ).toHaveLength(1);
  });
  it('fits a new plain chat and its tool step without carrying the full catalogue', async () => {
    const setup = fixture();
    const base = setup.modules[0]!.tools[0]!;
    const extras = Array.from({ length: 40 }, (_, index) =>
      defineTool({
        ...base,
        name: `budget.extra${index}`,
        description: 'An unrelated catalogue entry describing other material and editing choices. '.repeat(
          20,
        ),
      }),
    );
    const h = harness({
      modules: [defineToolModule({ id: 'budget', tools: [...setup.modules[0]!.tools, ...extras] })],
      deps: { contextWindow: () => window },
      script: turns(
        { toolCalls: [call('updatePlan', { steps: [{ text: 'Use budget.first for the material.' }] })] },
        { toolCalls: [call('findTools', { query: 'budget.last' })] },
        { toolCalls: [call('budget_last', { note: 'Use my selected material.' })] },
        { text: 'Done.' },
      ),
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Use my selected material.' }));
    expect(outcome.status).toBe('completed');
    const events = await h.events(outcome.runId);
    const fitted = ofType(events, 'context.compacted');
    expect(fitted.length).toBeGreaterThanOrEqual(2);
    expect(fitted.every((event) => event.payload.fits && event.payload.afterTokens <= budget)).toBe(true);
    expect(h.models.requests[0]!.tools?.map((tool) => tool.name)).toEqual(['updatePlan']);
    expect(h.models.requests[1]!.tools?.some((tool) => tool.name === 'findTools')).toBe(true);
    expect(h.models.requests[2]!.tools?.filter((tool) => tool.name.startsWith('budget_'))[0]?.name).toBe(
      'budget_last',
    );
  });

  it('keeps discovery and gives its latest explicit search priority over the original route', async () => {
    const setup = fixture();
    const h = harness({
      modules: setup.modules,
      deps: { skills: setup.skills, contextWindow: () => window },
      script: turns(
        plan,
        { toolCalls: [call('findTools', { query: 'budget.last' })] },
        { toolCalls: [call('budget_last', { note: 'Use the selected material.' })] },
        { toolCalls: [call('handOff', { done: true })] },
        { text: 'Done.' },
      ),
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Keep my selected material.' }));
    expect(outcome.status).toBe('completed');
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'tool.failed')).toEqual([]);
    const fitted = ofType(events, 'context.compacted');
    expect(fitted.length).toBeGreaterThan(0);
    for (const event of fitted) {
      expect(event.payload).toMatchObject({ window, budgetTokens: budget, fits: true });
      expect(event.payload.afterTokens).toBeLessThanOrEqual(budget);
    }
    const first = h.models.requests[1]!;
    expect(first.tools?.some((tool) => tool.name === 'budget_first')).toBe(true);
    expect(first.system).toContain('Use findTools to load another tool');
    expect(JSON.stringify(first.messages)).toContain('keep-project');
    const searched = h.models.requests[2]!;
    expect(searched.tools?.filter((tool) => tool.name.startsWith('budget_'))[0]?.name).toBe('budget_last');
    expect(searched.tools?.some((tool) => tool.name === 'handOff')).toBe(true);
    expect(unwrap(await h.agent.replay(outcome.runId)).promptDrift).toBe(0);
  });

  it('reports an oversized required schema before any one-token model request or no-tool loop', async () => {
    const setup = fixture(true);
    const h = harness({
      modules: setup.modules,
      deps: { skills: setup.skills, contextWindow: () => window },
      script: turns(plan, { text: 'This answer must not be requested.' }),
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Use the selected material.' }));
    expect(outcome.status).toBe('failed');
    expect(h.models.requests).toHaveLength(1);
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'run.failed').map((event) => event.payload.error.code)).toEqual([
      'models.context_too_long',
    ]);
    expect(ofType(events, 'model.requested')).toHaveLength(1);
    expect(ofType(events, 'context.compacted').at(-1)?.payload.fits).toBe(false);
    expect(unwrap(await h.agent.replay(outcome.runId)).promptDrift).toBe(0);
  });
});
