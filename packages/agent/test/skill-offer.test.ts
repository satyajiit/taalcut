// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-CTX: a skill step offers only the skill's tools. A skill that names all its tools (no more than a turn
 * carries, tool-offer.ts) gets exactly those on every turn, whatever findTools or the route loaded; one that
 * takes a family is offered the loaded tools it allows, as before. updatePlan, findTools and readArtifact stay.
 */
import {
  defineSkill,
  defineSkillModule,
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  ok,
  unwrap,
  type AnySkill,
} from '@taalcut/core';
import { createSkillRegistry } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toolOffer } from '../src/tool-offer';
import { call, harness, registryFor, turns } from './support/harness';

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
const SHELVES = ['fruit', 'bread', 'cheese', 'wine', 'milk', 'eggs', 'tea'];
const shop = defineToolModule({ id: 'shop', tools: SHELVES.map(shopTool) });
/** More than the five tools a step's route loads, so some would be missing without the whole offer. */
const PICKED = SHELVES.slice(0, 6).map((name) => `shop.${name}`);

const skill = (id: string, tools: AnySkill['tools']) =>
  defineSkill({
    id: `shop.${id}`,
    version: '1.0.0',
    labelKey: `skills.shop.${id}`,
    description: 'Looks at the shop shelves and hands off what it saw.',
    prompt: 'Look at the shelves, then hand off.',
    tools,
    input: z.object({}),
    output: z.object({ saw: z.string() }),
    refs: () => [],
  });

/** The model requests of the step's act turns, in a run whose one step is `skillId`. */
async function stepRequests(skillId: string) {
  const skills = unwrap(
    createSkillRegistry(
      [
        defineSkillModule({
          id: 'shop',
          skills: [skill('picker', { names: PICKED }), skill('browser', { families: ['shop'] })],
        }),
      ],
      registryFor([shop]),
    ),
  );
  const h = harness({
    script: turns(
      {
        toolCalls: [call('updatePlan', { steps: [{ text: 'Look at the shop', skill: skillId, input: {} }] })],
      },
      { toolCalls: [call('findTools', { query: 'cheese wine shelf' })] },
      { toolCalls: [call('handOff', { saw: 'shelves' })] },
      { text: 'Done.' },
    ),
    modules: [shop],
    deps: { skills },
  });
  unwrap(await h.agent.run({ conversationId: 'c', message: 'What is in the shop?' }));
  return h.models.requests.slice(1, 3);
}

/** The registry tools offered on each act turn of a run whose one step is `skillId`. */
async function offered(skillId: string) {
  return (await stepRequests(skillId)).map((request) =>
    (request.tools ?? []).map((tool) => tool.name).filter((name) => name.startsWith('shop_')),
  );
}

describe("a skill step's tools (LRN1-CTX)", () => {
  it('offers a skill that names its tools exactly those, before and after findTools', async () => {
    // AGT2: a window nobody knows gets the smallest offer: a turn carries 16, so six named tools fit whole.
    expect(toolOffer(undefined).turn).toBe(16);
    const all = PICKED.map((name) => name.replace('.', '_'));
    expect(await offered('shop.picker')).toEqual([all, all]);
  });

  it('offers a skill that takes a family the loaded tools it allows, findTools hits included', async () => {
    const [before, after] = await offered('shop.browser');
    // The route loads five; findTools adds its hits.
    expect(before).toHaveLength(5);
    expect(after).toEqual(expect.arrayContaining(['shop_cheese', 'shop_wine']));
  });

  it('leaves the tool catalogue out of the prompt of a skill offered all its tools, and keeps SOUL.md', async () => {
    const [picker] = await stepRequests('shop.picker');
    expect(picker?.system).not.toContain('# Tool catalogue');
    expect(picker?.system).toContain('- Act with tools. Every tool you can call is offered to you.');
    expect(picker?.system).toContain('# Skill: shop.picker');
    const [browser] = await stepRequests('shop.browser');
    expect(browser?.system).toContain('# Tool catalogue');
    expect(browser?.system).toContain('call findTools to load others from the catalogue below');
    // The persona is the same in both: a step's text reaches the user's chat (SPEC 35).
    const persona = (system: string | undefined) =>
      system?.slice(0, system.indexOf('# How you work in Taalcut'));
    expect(persona(picker?.system)).toBe(persona(browser?.system));
    expect(persona(picker?.system)?.length).toBeGreaterThan(0);
  });
});
