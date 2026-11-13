// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A bounded offer must not keep the tool just used and leave out the one that returns the handoff. */
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
import { call, harness, ofType, registryFor } from '../support/harness';

const window = 12_288;
const budget = 6_963;
const words = (count: number) => 'Keep the material and the requested timing together. '.repeat(count);

/**
 * `offer.start` is the route's best match and `offer.finish` the tool that makes the handoff's `made`. The two
 * schemas don't fit one request together; `offer.aside` is small enough to fit beside either.
 */
function fixture(options: { startReturns?: 'started' | 'made'; asideReturns?: 'noted' | 'made' } = {}) {
  const startReturns = options.startReturns ?? 'started';
  const asideReturns = options.asideReturns ?? 'noted';
  const tool = (name: string, size: number, output: z.ZodObject, value: Record<string, unknown>) =>
    defineTool({
      name: `offer.${name}`,
      version: '1.0.0',
      description: `Does the ${name} part of the work.`,
      input: z.object({ note: z.string().describe(words(size)) }),
      output,
      costClass: 'local',
      sideEffect: 'read',
      timeoutMs: 1_000,
      retry: NO_TOOL_RETRY,
      run: async () => ok(value),
    });
  const modules = [
    defineToolModule({
      id: 'offer',
      tools: [
        tool('start', 200, z.object({ [startReturns]: z.string() }), { [startReturns]: 'yes' }),
        tool('aside', 20, z.object({ [asideReturns]: z.string() }), { [asideReturns]: 'a-note' }),
        tool('finish', 220, z.object({ made: z.string() }), { made: 'the-video' }),
      ],
    }),
  ];
  const skill = defineSkill({
    id: 'offer.work',
    version: '1.0.0',
    labelKey: 'skills.test',
    description: 'Use offer.start to start the work.',
    prompt: 'Start the work, finish it, then hand off what the tools returned.',
    tools: { families: ['offer'] },
    input: z.object({ project: z.string() }),
    output: z.object({ made: z.string() }),
    refs: () => [],
    // The check names what makes the video, as the Maker's names render.draft and video.done.
    verify: async (output) =>
      ok(
        ['the-video', 'yes'].includes(output.made)
          ? { verdict: 'pass' as const }
          : {
              verdict: 'retry' as const,
              reason: `Nothing made is called ${output.made}: offer.finish makes the video. Call it, then hand off.`,
            },
      ),
  });
  const skills = unwrap(
    createSkillRegistry([defineSkillModule({ id: 'offer', skills: [skill] })], registryFor(modules)),
  );
  return { modules, skills };
}

const plan = {
  toolCalls: [
    call('updatePlan', { steps: [{ text: 'Work', skill: 'offer.work', input: { project: 'p' } }] }),
  ],
};
const domain = (request: { tools?: readonly { name: string }[] }) =>
  (request.tools ?? []).map((tool) => tool.name).filter((name) => name.startsWith('offer_'));

describe('a bounded offer and the tool that finishes the step', () => {
  it('leads with the tool that returns the handoff once the step has completed its first tool', async () => {
    const setup = fixture();
    const offers: string[][] = [];
    const h = harness({
      modules: setup.modules,
      deps: { skills: setup.skills, contextWindow: () => window },
      // This model never searches: it can only call what a request offers, as the 4B did on the owner's Mac mini.
      script: (request, turn) => {
        if (turn === 0) return plan;
        if (!request.system?.includes('# Skill: offer.work')) return { text: 'Done.' };
        const offered = domain(request);
        offers.push(offered);
        const said = JSON.stringify(request.messages);
        if (said.includes('the-video')) return { toolCalls: [call('handOff', { made: 'the-video' })] };
        if (offered.includes('offer_finish') && said.includes('started'))
          return { toolCalls: [call('offer_finish', { note: 'Finish it.' })] };
        if (offered.includes('offer_start'))
          return { toolCalls: [call('offer_start', { note: 'Start it.' })] };
        return { text: 'Nothing offered finishes this.' };
      },
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Make it.' }));
    const events = await h.events(outcome.runId);
    expect(outcome.status, JSON.stringify(ofType(events, 'run.failed'))).toBe('completed');
    // Before anything is done the route's best match starts the step; the schema that cannot fit beside it waits.
    expect(offers[0]).toEqual(['offer_start', 'offer_aside']);
    expect(offers[1]).toEqual(['offer_finish', 'offer_aside']);
    expect(ofType(events, 'tool.requested').map((event) => event.payload.tool)).toEqual([
      'updatePlan',
      'offer.start',
      'offer.finish',
      'handOff',
    ]);
    const fitted = ofType(events, 'context.compacted');
    expect(fitted.length).toBeGreaterThan(0);
    for (const event of fitted) {
      expect(event.payload).toMatchObject({ window, budgetTokens: budget, fits: true });
      expect(event.payload.afterTokens).toBeLessThanOrEqual(budget);
    }
    expect(unwrap(await h.agent.replay(outcome.runId)).promptDrift).toBe(0);
  });

  it('keeps the route’s order when the completed tool already returned what the handoff needs', async () => {
    const setup = fixture({ startReturns: 'made' });
    const offers: string[][] = [];
    const h = harness({
      modules: setup.modules,
      deps: { skills: setup.skills, contextWindow: () => window },
      script: (request, turn) => {
        if (turn === 0) return plan;
        if (!request.system?.includes('# Skill: offer.work')) return { text: 'Done.' };
        offers.push(domain(request));
        // The same tool again: a step that repeats a tool must keep finding it in the offer.
        if (offers.length < 3) return { toolCalls: [call('offer_start', { note: 'Again.' })] };
        return { toolCalls: [call('handOff', { made: 'yes' })] };
      },
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Make it.' }));
    expect(outcome.status).toBe('completed');
    expect(offers).toEqual([
      ['offer_start', 'offer_aside'],
      ['offer_start', 'offer_aside'],
      ['offer_start', 'offer_aside'],
    ]);
  });
  it('keeps the route’s order while several tools return what the handoff lacks, then offers what a failed check names', async () => {
    // The Maker in the installed run: any edit returns its handoff's fields, so those say nothing about what comes
    // next; its check then named render.draft and video.done while the offer held three library tools.
    const setup = fixture({ asideReturns: 'made' });
    const offers: string[][] = [];
    const h = harness({
      modules: setup.modules,
      deps: { skills: setup.skills, contextWindow: () => window },
      script: (request, turn) => {
        if (turn === 0) return plan;
        if (!request.system?.includes('# Skill: offer.work')) return { text: 'Done.' };
        const offered = domain(request);
        offers.push(offered);
        const said = JSON.stringify(request.messages);
        if (said.includes('the-video')) return { toolCalls: [call('handOff', { made: 'the-video' })] };
        if (offered.includes('offer_finish'))
          return { toolCalls: [call('offer_finish', { note: 'Finish it.' })] };
        // Like the 4B: with nothing offered that finishes the work, it hands off an id it has.
        if (said.includes('started')) return { toolCalls: [call('handOff', { made: 'a-cast' })] };
        return { toolCalls: [call('offer_start', { note: 'Start it.' })] };
      },
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Make it.' }));
    const events = await h.events(outcome.runId);
    expect(outcome.status, JSON.stringify([offers, ofType(events, 'run.failed')])).toBe('completed');
    expect(offers).toEqual([
      ['offer_start', 'offer_aside'],
      ['offer_start', 'offer_aside'],
      ['offer_finish', 'offer_aside'],
      ['offer_start', 'offer_aside'],
    ]);
    expect(ofType(events, 'verify.result').map((event) => event.payload.verdict)).toEqual(['retry', 'pass']);
    expect(unwrap(await h.agent.replay(outcome.runId)).promptDrift).toBe(0);
  });

  it('offers a tool the check names even when the newest loaded tools no longer include it', async () => {
    const setup = fixture({ asideReturns: 'made' });
    const base = setup.modules[0]!.tools[1]!;
    // A search loads enough other tools that the step's own fall out of the newest loaded.
    const found = Array.from({ length: 8 }, (_, index) =>
      defineTool({ ...base, name: `offer.found${index}`, description: `Looks up clips of kind ${index}.` }),
    );
    const modules = [defineToolModule({ id: 'offer', tools: [...setup.modules[0]!.tools, ...found] })];
    const skills = unwrap(
      createSkillRegistry(
        [defineSkillModule({ id: 'offer', skills: [setup.skills.get('offer.work')!] })],
        registryFor(modules),
      ),
    );
    const offers: string[][] = [];
    const h = harness({
      modules,
      deps: { skills, contextWindow: () => window },
      script: (request, turn) => {
        if (turn === 0) return plan;
        if (!request.system?.includes('# Skill: offer.work')) return { text: 'Done.' };
        const offered = domain(request);
        offers.push(offered);
        const said = JSON.stringify(request.messages);
        if (said.includes('the-video')) return { toolCalls: [call('handOff', { made: 'the-video' })] };
        if (said.includes('offer.finish makes the video'))
          return offered.includes('offer_finish')
            ? { toolCalls: [call('offer_finish', { note: 'Finish it.' })] }
            : { toolCalls: [call('handOff', { made: 'a-cast' })] };
        if (offers.length === 1)
          return { toolCalls: [call('findTools', { query: 'looks up clips of kind' })] };
        return { toolCalls: [call('handOff', { made: 'a-cast' })] };
      },
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Make it.' }));
    const events = await h.events(outcome.runId);
    expect(outcome.status, JSON.stringify([offers, ofType(events, 'run.failed')])).toBe('completed');
    // The search's tools come first on the turn after it; after the check, the tool it names does.
    expect(offers[1]?.[0]).toMatch(/^offer_found/);
    expect(offers[1]).not.toContain('offer_finish');
    expect(offers[2]?.[0]).toBe('offer_finish');
    expect(ofType(events, 'tool.requested').map((event) => event.payload.tool)).toEqual([
      'updatePlan',
      'findTools',
      'handOff',
      'offer.finish',
      'handOff',
    ]);
  });
});
