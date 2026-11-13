// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Maker's real prompt and schemas at 12,288 tokens, with a model that calls only what a request offers.
 * 0.1.0-beta.1's installed run on the Mac mini (Qwen3.5 4B): a tool search filled the offer with library tools, the
 * check then said "render.draft revision 2, then video.done", and neither was offered again. The model could only
 * hand off the same thing until the retries ran out.
 */
import { afterEach, expect, it } from 'vitest';
import { defineSkillModule, ok, unwrap } from '@taalcut/core';
import {
  createAgent,
  createMemoryEventLogStore,
  createScriptedModelClient,
  createSkillRegistry,
  parseSoul,
} from '@taalcut/agent';
import { createMemoryArtifactStore } from '@taalcut/tools';
import { ToolRegistryToken } from '../src/shared/tokens';
import { SkillRegistryToken } from '../src/utility/roots/agent-flows';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { SOUL, testAgent, testConfig } from './helpers/roots';
import { budgetIds, makeFlowBudgetFixture } from './helpers/make-flow-budget';

afterEach(closeAllPorts);

const NO_DRAFT =
  'There is no draft of this timeline yet: render.draft revision 3, then video.done. Call video.done (with a reason for each slot that must stay), then hand off.';

it('offers render.draft and then video.done once the Maker’s check names them', async () => {
  const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
  try {
    const tools = root.container.resolve(ToolRegistryToken);
    const live = root.container.resolve(SkillRegistryToken).get('timeline.maker')!;
    const executed: string[] = [];
    // The real check reads stores and a render; this one says what the real one said in the installed run.
    const skill = {
      ...live,
      card: undefined,
      verify: async () =>
        ok(
          executed.includes('video.done')
            ? { verdict: 'pass' as const }
            : { verdict: 'retry' as const, reason: NO_DRAFT },
        ),
    };
    const skills = unwrap(
      createSkillRegistry([defineSkillModule({ id: 'timeline', skills: [skill] })], tools),
    );
    const fixture = makeFlowBudgetFixture();
    const outputs: Record<string, unknown> = { 'render.draft': fixture.draft, 'video.done': fixture.done };
    const ask = { projectId: budgetIds.projectId, timelineId: budgetIds.timelineId };
    const offers: string[][] = [];
    const models = createScriptedModelClient((request, turn) => {
      if (!request.system?.includes('# Skill: timeline.maker'))
        return turn === 0
          ? {
              toolCalls: [
                {
                  name: 'updatePlan',
                  arguments: {
                    steps: [
                      {
                        text: 'Make the video match the reel.',
                        skill: 'timeline.maker',
                        input: { ...ask, templateId: budgetIds.templateId },
                      },
                    ],
                  },
                },
              ],
            }
          : { text: 'Finished.' };
      const offered = request.tools?.map((tool) => tool.name) ?? [];
      offers.push(offered);
      const use = (name: string, args: Record<string, unknown>) => ({
        toolCalls: [{ id: `call-${offers.length}`, name, arguments: args }],
      });
      const handOff = use('handOff', {
        timelineId: budgetIds.timelineId,
        revision: 3,
        ...(executed.includes('render.draft') ? { renderId: budgetIds.renderId } : {}),
      });
      // The 4B's first move in the installed run: a search that loads library tools.
      if (offers.length === 1) return use('findTools', { query: 'drone shot city night Vietnam' });
      if (executed.includes('video.done')) return handOff;
      // It calls what the latest check names when a request offers it, and otherwise hands off what it has.
      if (executed.includes('render.draft') && offered.includes('video_done')) return use('video_done', ask);
      if (offers.length > 2 && offered.includes('render_draft'))
        return use('render_draft', { ...ask, revision: 3 });
      return handOff;
    });
    const log = createMemoryEventLogStore();
    const agent = createAgent({
      models,
      tools,
      skills,
      log,
      artifacts: createMemoryArtifactStore(),
      soul: parseSoul(SOUL),
      contextWindow: () => 12_288,
      settings: { autonomy: 'autopilot', localOnly: true, budget: {} },
      executor: {
        async execute(name, args, options) {
          const tool = tools.resolve(name)!;
          const key = tool.descriptor.name;
          expect(Object.hasOwn(outputs, key), `Unexpected domain call ${key}`).toBe(true);
          expect(tool.spec.input.safeParse(tool.spec.mendInput?.(args) ?? args).success, name).toBe(true);
          executed.push(key);
          const value = outputs[key];
          return ok({
            tool: key,
            value,
            callId: options!.callId!,
            version: tool.descriptor.version,
            inputHash: 'fixture',
            output: { kind: 'inline' as const, value },
            cached: false,
            deduplicated: false,
            attempts: 1,
            durationMs: 0,
            usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
          });
        },
      },
    });
    const result = unwrap(
      await agent.run({
        conversationId: 'maker-check-offer',
        projectId: budgetIds.projectId,
        message: 'Make a video with my template “Courtyard reel”',
      }),
    );
    const events = unwrap(await log.read(result.runId));
    expect(
      result.status,
      JSON.stringify([offers, events.filter((event) => event.type === 'run.failed')]),
    ).toBe('completed');
    // The search's tools filled the offer the first handoff was made from: the case the installed run hit.
    expect(offers[1]).not.toContain('render_draft');
    expect(offers[2]).toContain('render_draft');
    expect(offers[3]).toContain('video_done');
    expect(executed).toEqual(['render.draft', 'video.done']);
    const verdicts = events.flatMap((event) =>
      event.type === 'verify.result' ? [event.payload.verdict] : [],
    );
    expect(verdicts).toEqual(['retry', 'pass']);
    const fitted = events.filter((event) => event.type === 'context.compacted');
    expect(fitted.length).toBeGreaterThan(0);
    for (const event of fitted) {
      expect(event.payload).toMatchObject({ window: 12_288, budgetTokens: 6_963, fits: true });
      expect(event.payload.afterTokens).toBeLessThanOrEqual(6_963);
    }
    expect(unwrap(await agent.replay(result.runId))).toMatchObject({ status: 'completed', promptDrift: 0 });
  } finally {
    await root.container.dispose();
  }
}, 30_000);
