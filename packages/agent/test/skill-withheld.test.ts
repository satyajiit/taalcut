// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE: a skill withholds tools given a step's input (core's SkillSpec.withheldTools). The Librarian given a
 * template has no tool to choose or plan another: on the owner's paste it planned a generic video instead. A
 * withheld tool is not offered, not found by findTools, not in the step's catalogue, and refused if called; a step
 * whose input withholds nothing has it as before.
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
import { createSkillRegistry } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { call, harness, ofType, registryFor, turns } from './support/harness';

const shopTool = (name: string) =>
  defineTool({
    name: `shop.${name}`,
    version: '1.0.0',
    description: `Looks at the shop's ${name} shelf.`,
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1_000,
    retry: NO_TOOL_RETRY,
    run: async () => ok({ ok: true }),
  });
const shop = defineToolModule({
  id: 'shop',
  tools: ['fruit', 'bread', 'cheese', 'wine', 'milk', 'eggs', 'tea'].map(shopTool),
});

/** Like the Librarian: a family's tools, two of them withheld when the step is given what they would choose. */
const browser = defineSkill({
  id: 'shop.browser',
  version: '1.0.0',
  labelKey: 'skills.shop.browser',
  description: 'Looks at the shop shelves and hands off what it saw.',
  prompt: 'Look at the shelves, then hand off.',
  tools: { families: ['shop'] },
  withheldTools: (input) => (input.given ? ['shop.cheese', 'shop.wine'] : []),
  input: z.object({ given: z.boolean() }),
  output: z.object({ saw: z.string() }),
  refs: () => [],
});

async function step(given: boolean) {
  const skills = unwrap(
    createSkillRegistry([defineSkillModule({ id: 'shop', skills: [browser] })], registryFor([shop])),
  );
  const h = harness({
    script: turns(
      {
        toolCalls: [
          call('updatePlan', {
            steps: [{ text: 'Look at the shop', skill: 'shop.browser', input: { given } }],
          }),
        ],
      },
      { toolCalls: [call('findTools', { query: 'cheese wine shelf' })] },
      { toolCalls: [call('shop_cheese', {})] },
      { toolCalls: [call('handOff', { saw: 'shelves' })] },
      { text: 'Done.' },
    ),
    modules: [shop],
    deps: { skills },
  });
  const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'What is in the shop?' }));
  const requests = h.models.requests.slice(1, 4);
  const offered = requests.map((request) =>
    (request.tools ?? []).map((tool) => tool.name).filter((name) => name.startsWith('shop_')),
  );
  return { requests, offered, events: await h.events(outcome.runId) };
}

describe('a skill step withholds tools given its input (BRK1-MAKE)', () => {
  it('neither offers, finds, lists nor runs a withheld tool', async () => {
    const { requests, offered, events } = await step(true);
    for (const tools of offered) expect(tools).not.toEqual(expect.arrayContaining(['shop_cheese']));
    for (const tools of offered) expect(tools).not.toContain('shop_wine');
    // findTools found other shelves, not the withheld ones.
    expect(offered[1]!.length).toBeGreaterThan(0);
    for (const request of requests) expect(request.system).not.toMatch(/shop\.(cheese|wine)/);
    const failed = ofType(events, 'tool.failed').map((e) => e.payload.error.code);
    expect(failed).toEqual(['agent.outside_skill']);
    expect(ofType(events, 'skill.handedOff')).toHaveLength(1);
  });

  it('has them as before when its input withholds nothing', async () => {
    const { offered, events } = await step(false);
    expect(offered[1]).toEqual(expect.arrayContaining(['shop_cheese', 'shop_wine']));
    expect(ofType(events, 'tool.failed')).toEqual([]);
  });
});
