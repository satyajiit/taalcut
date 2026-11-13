// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: a step's tool offer is sized by its models' context window (tool-offer.ts), logged with its route, and the
 * same on resume and replay. The 8k on-device model keeps LRN1's offer; a cloud or subscription model is offered every
 * tool the step allows; a step is routed on what its input needs, each tool a fix names first.
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
import { fixTools, needWords, queryTools } from '../src/route-query';
import { MEDIUM_WINDOW, SMALL_WINDOW, toolOffer, WHOLE_WINDOW } from '../src/tool-offer';
import { call, harness, ofType, registryFor, turns } from './support/harness';

const shelfTool = (name: string) =>
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
/** More shelves than the 4B's search loads, and than the 9B's. */
const SHELVES = Array.from({ length: 20 }, (_, index) => `shelf${index + 1}`);
const shop = defineToolModule({ id: 'shop', tools: SHELVES.map(shelfTool) });
const callName = (name: string) => name.replace('.', '_');
/** What the step's findTools names: more than the 4B loads in one call. */
const FOUND = SHELVES.slice(8).map((name) => `shop.${name}`);

const skillOf = (description: string): AnySkill =>
  defineSkill({
    id: 'shop.browser',
    version: '1.0.0',
    labelKey: 'skills.shop.browser',
    description,
    prompt: 'Look at the shelves, then hand off.',
    tools: { families: ['shop'] },
    input: z.object({ fixes: z.array(z.unknown()).optional() }),
    output: z.object({ saw: z.string() }),
    refs: () => [],
  }) as unknown as AnySkill;

const browser: AnySkill = defineSkill({
  id: 'shop.browser',
  version: '1.0.0',
  labelKey: 'skills.shop.browser',
  description: 'Looks at the shop shelves and hands off what it saw.',
  prompt: 'Look at the shelves, then hand off.',
  tools: { families: ['shop'] },
  input: z.object({ fixes: z.array(z.unknown()).optional() }),
  output: z.object({ saw: z.string() }),
  refs: () => [],
}) as unknown as AnySkill;

async function run(window: number | undefined, input: Record<string, unknown> = {}, skill = browser) {
  const skills = unwrap(
    createSkillRegistry([defineSkillModule({ id: 'shop', skills: [skill] })], registryFor([shop])),
  );
  const h = harness({
    script: turns(
      {
        toolCalls: [
          call('updatePlan', { steps: [{ text: 'Look at the shop', skill: 'shop.browser', input }] }),
        ],
      },
      { toolCalls: [call('findTools', { query: FOUND.join(' ') })] },
      { toolCalls: [call('handOff', { saw: 'shelves' })] },
      { text: 'Done.' },
    ),
    modules: [shop],
    deps: { skills, ...(window !== undefined ? { contextWindow: () => window } : {}) },
  });
  const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'What is in the shop?' }));
  const events = await h.events(outcome.runId);
  const offered = h.models.requests
    .slice(1, 3)
    .map((request) =>
      (request.tools ?? []).map((tool) => tool.name).filter((name) => name.startsWith('shop_')),
    );
  return { h, outcome, events, offered, requests: h.models.requests.slice(1, 3) };
}

describe('the tool offer sized by the window (AGT2)', () => {
  it('keeps the 4B offer, eight on the 9B, and every tool from a cloud window', () => {
    expect(toolOffer(SMALL_WINDOW)).toEqual({ all: false, search: 5, turn: 16, catalogue: 16 });
    expect(toolOffer(undefined)).toEqual(toolOffer(SMALL_WINDOW));
    expect(toolOffer(4_096)).toEqual(toolOffer(SMALL_WINDOW));
    expect(toolOffer(MEDIUM_WINDOW)).toEqual({ all: false, search: 8, turn: 32, catalogue: 64 });
    // The 4B on a recommended Mac.
    expect(toolOffer(12_288)).toEqual({ all: false, search: 6, turn: 19, catalogue: 24 });
    expect(toolOffer(WHOLE_WINDOW - 1).all).toBe(false);
    expect(toolOffer(WHOLE_WINDOW).all).toBe(true);
    expect(toolOffer(400_000).all).toBe(true);
  });

  it('offers a family skill on the 4B its five best, and findTools five more', async () => {
    const { offered, events } = await run(SMALL_WINDOW);
    expect(offered[0]).toHaveLength(5);
    // findTools loads the first five it names, beside the route's.
    expect(offered[1]).toEqual(expect.arrayContaining(FOUND.slice(0, 5).map(callName)));
    expect(offered[1]).not.toContain(callName(FOUND[5]!));
    expect(ofType(events, 'route.chosen')[0]?.payload).toMatchObject({ window: SMALL_WINDOW });
  });

  it('offers it eight on the 9B, and findTools eight more within the turn', async () => {
    const { offered } = await run(MEDIUM_WINDOW);
    expect(offered[0]).toHaveLength(8);
    expect(offered[1]).toEqual(expect.arrayContaining(FOUND.slice(0, 8).map(callName)));
    expect(offered[1]).not.toContain(callName(FOUND[8]!));
  });

  it('offers every tool from the first turn on a cloud window, with no catalogue, and logs that offer', async () => {
    const { offered, events, requests } = await run(200_000);
    const all = SHELVES.map((name) => `shop_${name}`);
    expect(offered[0]?.sort()).toEqual([...all].sort());
    expect(offered[1]?.sort()).toEqual([...all].sort());
    expect(requests[0]?.system).not.toContain('# Tool catalogue');
    const route = ofType(events, 'route.chosen')[0]?.payload;
    expect(route?.window).toBe(200_000);
    expect(route?.tools).toHaveLength(SHELVES.length);
  });

  it('offers a plain step every tool on any cloud window, so every cloud model is offered the same', async () => {
    const plain = async (window: number) => {
      const h = harness({
        script: turns(
          { toolCalls: [call('updatePlan', { steps: [{ text: 'Look at shop.shelf3' }] })] },
          { text: 'Done.' },
        ),
        modules: [shop],
        deps: { contextWindow: () => window },
      });
      const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'What is on shop.shelf3?' }));
      const route = ofType(await h.events(outcome.runId), 'route.chosen')[0]?.payload;
      const offered = (h.models.requests[1]?.tools ?? [])
        .map((tool) => tool.name)
        .filter((name) => name.startsWith('shop_'));
      return { route, offered };
    };
    const sol = await plain(272_000);
    const sonnet = await plain(1_000_000);
    expect(sol.route?.tools).toHaveLength(SHELVES.length);
    expect(sol.route?.tools[0]).toBe('shop.shelf3');
    expect(sonnet.route?.tools).toEqual(sol.route?.tools);
    expect(sol.offered).toHaveLength(SHELVES.length);
    // Below a cloud window a plain step still searches: the 4B's five.
    const small = await plain(SMALL_WINDOW);
    expect(small.route?.tools.length).toBeLessThanOrEqual(5);
  });

  it('replays a cloud run with the offer it logged, whatever the replay window', async () => {
    const { h, outcome } = await run(200_000);
    expect(unwrap(await h.agent.replay(outcome.runId))).toMatchObject({
      promptDrift: 0,
      status: 'completed',
    });
  });

  it('routes a step on its fixes, each fix’s tool loaded first', async () => {
    const fixes = [
      { kind: 'command', labelKey: 'qa.fix.shelf', command: 'shop.shelf17', payload: {} },
      {
        kind: 'agent',
        instructionKey: 'qa.fix.restock',
        params: { slot: 2, tools: 'shop.shelf19 shop.shelf3' },
      },
    ];
    const { events } = await run(SMALL_WINDOW, { fixes });
    const route = ofType(events, 'route.chosen')[0]?.payload;
    expect(route?.tools.slice(0, 3)).toEqual(['shop.shelf17', 'shop.shelf19', 'shop.shelf3']);
    expect(route?.query).toContain('restock');
    expect(fixTools({ fixes })).toEqual(['shop.shelf17', 'shop.shelf19', 'shop.shelf3']);
    expect(needWords({ request: 'make it warmer' })).toBe('make it warmer');
    expect(needWords({})).toBe('');
  });

  it('reads a fix’s tools however they are separated: spaces, or commas as slot match writes them', () => {
    const agentFix = (tools: string) => ({
      kind: 'agent',
      instructionKey: 'qa.fix.restock',
      params: { tools },
    });
    const expected = ['shop.shelf19', 'shop.shelf3', 'shop.shelf7'];
    expect(fixTools({ fixes: [agentFix('shop.shelf19 shop.shelf3 shop.shelf7')] })).toEqual(expected);
    expect(fixTools({ fixes: [agentFix('shop.shelf19, shop.shelf3, shop.shelf7')] })).toEqual(expected);
    expect(fixTools({ fixes: [agentFix('shop.shelf19,shop.shelf3 ,shop.shelf7')] })).toEqual(expected);
  });

  it('lists sixteen of the skill’s twenty tools on the 4B, says findTools finds the rest, and all on the 9B', async () => {
    const small = (await run(SMALL_WINDOW)).requests[0]?.system ?? '';
    const lines = (system: string) => system.split('\n').filter((line) => line.startsWith('shop: shop.'));
    expect(lines(small)).toHaveLength(16);
    expect(small).toContain(
      "4 more of this skill's tools are not listed: findTools finds them by what they do.",
    );
    const medium = (await run(MEDIUM_WINDOW)).requests[0]?.system ?? '';
    expect(lines(medium)).toHaveLength(SHELVES.length);
    expect(medium).not.toContain('more of this skill');
  });

  it('loads the tools its description names first, within the limit', async () => {
    const named = skillOf('Looks at shop.shelf18 and shop.shelf20 first, then the other shelves.');
    const { events } = await run(SMALL_WINDOW, {}, named);
    const route = ofType(events, 'route.chosen')[0]?.payload;
    expect(route?.tools.slice(0, 2)).toEqual(['shop.shelf18', 'shop.shelf20']);
    expect(route?.tools).toHaveLength(5);
    expect(queryTools('reads it with timeline.get, then video.done; timeline.get again')).toEqual([
      'timeline.get',
      'video.done',
    ]);
  });
});
