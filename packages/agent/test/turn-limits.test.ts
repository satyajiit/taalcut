// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-CTX, SPEC section 35: a skill step gets its own turn budget on every path that runs it. A long skill's is far
 * above a plain run's 40 (the Analyst's, packages/templates ANALYST_MAX_TURNS, is sized for a 60-slot reel), so each
 * path runs a skill with such a budget well past 40 turns: a plan a chat ask made, a flow, and a run resumed by
 * another agent over the same log. A step still stops at its own limit.
 */
import {
  CONTROL_PREFIX,
  createMemoryEventLogStore,
  createSkillRegistry,
  DEFAULT_LOOP_SETTINGS,
  foldEvents,
  runTurnLimit,
  SKILL_INPUT_NOTE,
  type ModelScript,
  type ScriptedReply,
} from '@taalcut/agent';
import {
  defineSkill,
  defineSkillModule,
  defineTool,
  defineToolModule,
  NO_TOOL_RETRY,
  ok,
  unwrap,
} from '@taalcut/core';
import type { ModelRequest } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { flowHarness } from './support/flow-harness';
import { flowScript, text } from './support/flow-script';
import { call, harness, ofType, registryFor } from './support/harness';

/** A long skill's own turn limit, well past a plain run's 40 (the agent doesn't import templates' Analyst). */
const SKILL_MAX_TURNS = 150;

const shelf = defineTool({
  name: 'shop.look',
  version: '1.0.0',
  description: 'Looks at one shelf.',
  input: z.object({ shelf: z.int() }),
  output: z.object({ seen: z.int() }),
  costClass: 'local',
  sideEffect: 'read',
  timeoutMs: 1_000,
  retry: NO_TOOL_RETRY,
  run: async ({ shelf: seen }) => ok({ seen }),
});
const shop = defineToolModule({ id: 'shop', tools: [shelf] });
const stocktake = defineSkill({
  id: 'shop.stocktake',
  version: '1.0.0',
  labelKey: 'skills.shop.stocktake',
  description: 'Looks at every shelf, one a turn, then hands off how many it saw.',
  prompt: 'Look at every shelf, then hand off.',
  tools: { names: ['shop.look'] },
  questions: ['variants'],
  input: z.object({}),
  output: z.object({ shelves: z.int() }),
  refs: () => [],
  limits: { maxTurns: SKILL_MAX_TURNS },
});
const skills = unwrap(
  createSkillRegistry([defineSkillModule({ id: 'shop', skills: [stocktake] })], registryFor([shop])),
);
const PLAN: ScriptedReply = {
  toolCalls: [call('updatePlan', { steps: [{ text: 'Stocktake', skill: 'shop.stocktake', input: {} }] })],
};

/** Plans the skill, looks at `shelves` shelves (asking the user after `askAfter` of them), hands off, then answers. */
function stocktakeScript(shelves: number, askAfter?: number): ModelScript {
  return (_request, turn) => {
    if (turn === 0) return PLAN;
    if (askAfter !== undefined && turn === askAfter + 1)
      return { toolCalls: [call('askUser', { question: 'variants', suggested: 2 })] };
    const asked = askAfter !== undefined && turn > askAfter + 1 ? 1 : 0;
    const looked = turn - 1 - asked;
    if (looked < shelves) return { toolCalls: [call('shop_look', { shelf: looked })] };
    if (looked === shelves) return { toolCalls: [call('handOff', { shelves })] };
    return { text: 'Done.' };
  };
}

const looks = (events: Awaited<ReturnType<ReturnType<typeof harness>['events']>>) =>
  ofType(events, 'tool.requested').filter((e) => e.payload.tool === 'shop.look').length;

describe("a skill step's turn budget (LRN1-CTX)", () => {
  it('runs a skill a chat ask planned on its own budget, past a plain run’s 40 turns', async () => {
    const shelves = 120;
    expect(shelves + 2).toBeGreaterThan(DEFAULT_LOOP_SETTINGS.maxTurns);
    const h = harness({ script: stocktakeScript(shelves), modules: [shop], deps: { skills } });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Count the shelves' }));
    expect(outcome.status).toBe('completed');
    const events = await h.events(outcome.runId);
    expect(looks(events)).toBe(shelves);
    // The run's limit: the loop's own 40 for the turns outside skills, plus the skill's own.
    expect(runTurnLimit(foldEvents(outcome.runId, events), skills, DEFAULT_LOOP_SETTINGS)).toBe(
      DEFAULT_LOOP_SETTINGS.maxTurns + SKILL_MAX_TURNS,
    );
  });

  it('still stops a skill at its own limit', async () => {
    const h = harness({ script: stocktakeScript(SKILL_MAX_TURNS), modules: [shop], deps: { skills } });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Count the shelves' }));
    expect(outcome).toMatchObject({
      status: 'failed',
      error: { code: 'agent.turn_limit', params: { limit: SKILL_MAX_TURNS } },
    });
  });

  it('offers only handOff on the last turn, so a model that would go on hands off what it has (FIX-LIBRARIAN)', async () => {
    // It would look at shelves for ever; given only handOff, it hands off how many it saw.
    const endless: ModelScript = (request, turn) => {
      if (turn === 0) return PLAN;
      const offered = (request.tools ?? []).map((t) => t.name);
      const looked = turn - 1;
      if (offered.join() === 'handOff') return { toolCalls: [call('handOff', { shelves: looked })] };
      if (offered.includes('handOff') && looked <= SKILL_MAX_TURNS)
        return { toolCalls: [call('shop_look', { shelf: looked })] };
      return { text: 'Done.' };
    };
    const h = harness({ script: endless, modules: [shop], deps: { skills } });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Count the shelves' }));
    expect(outcome.status).toBe('completed');
    const events = await h.events(outcome.runId);
    expect(looks(events)).toBe(SKILL_MAX_TURNS - 1);
    expect(ofType(events, 'skill.handedOff')[0]?.payload.output).toEqual({ shelves: SKILL_MAX_TURNS - 1 });
    const last = h.models.requests.findLast((r) => r.system?.includes('# Skill: shop.stocktake'));
    expect(last?.tools?.map((t) => t.name)).toEqual(['handOff']);
    expect(last?.system).toContain("This is the step's last turn");
  });

  it('keeps the budget in a run another agent resumes from the log', async () => {
    const store = createMemoryEventLogStore();
    const script = stocktakeScript(120, 30);
    const settings = { autonomy: 'before-render' as const };
    const first = harness({ script, modules: [shop], deps: { skills }, store, settings });
    const runId = unwrap(await first.agent.start({ conversationId: 'c', message: 'Count the shelves' }));
    const asked = unwrap(await first.agent.wait(runId));
    expect(asked.status).toBe('paused');
    first.agent.close();

    const second = harness({ script, modules: [shop], deps: { skills }, store, settings });
    const requestId = asked.pending[0]?.requestId ?? '';
    unwrap(
      await second.agent.answer(runId, {
        requestId,
        decision: 'approve',
        answer: { kind: 'variants', count: 1 },
      }),
    );
    const done = unwrap(await second.agent.wait(runId));
    expect(done.status).toBe('completed');
    expect(looks(await second.events(runId))).toBe(120);
  });

  it('gives the Analyst its whole budget in a flow, however low the loop’s own limit', async () => {
    const analystTurns = SKILL_MAX_TURNS;
    const h = flowHarness({
      script: longAnalyst(analystTurns - 1, flowScript({ ask: false, variants: 1 })),
      skills: { analystMaxTurns: SKILL_MAX_TURNS },
      settings: { loop: { maxTurns: 10 } },
    });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Copy this reel',
        start: { path: 'reference', reference: { kind: 'link', url: 'https://www.instagram.com/reel/r/' } },
      }),
    );
    const outcome = unwrap(await h.agent.wait(runId));
    // It reaches the export, which waits for the user before rendering.
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    const events = await h.events(runId);
    expect(
      ofType(events, 'tool.requested').filter((e) => e.payload.tool === 'templates.breakdown'),
    ).toHaveLength(analystTurns - 1);
    expect(ofType(events, 'skill.entered').map((e) => e.payload.skill)).toContain('render.reviewer');
  });
});

/** The flow script, with the Analyst breaking the reel down `extra` times before it hands off. */
function longAnalyst(extra: number, flow: ModelScript): ModelScript {
  return (request, turn) => {
    if (!/# Skill: templates\.analyst\b/.test(request.system ?? '')) return flow(request, turn);
    const done = analystTurns(request);
    if (done < extra) return { toolCalls: [call('templates_breakdown', { reference: { kind: 'link' } })] };
    return flow(request, turn);
  };
}

/** Model turns the skill step has taken: assistant messages after its input note. */
function analystTurns(request: ModelRequest): number {
  const marker = `${CONTROL_PREFIX} ${SKILL_INPUT_NOTE}`;
  const at = request.messages.findLastIndex((m) => m.role === 'user' && text(m).startsWith(marker));
  return request.messages.slice(at + 1).filter((m) => m.role === 'assistant').length;
}
