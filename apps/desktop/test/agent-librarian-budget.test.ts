// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Librarian's real prompt and schemas at 12,288 tokens, with a model that calls only what a request offers.
 * 0.1.0-beta.1's installed run on the Mac mini (Qwen3.5 4B): after timeline.cast the fitted offer left out
 * timeline.assemble, and the model handed off timeline ids it made up, three runs of three.
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
import { flowExtensionDeps } from '../src/utility/roots/agent-gaps';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { SOUL, testAgent, testConfig } from './helpers/roots';

afterEach(closeAllPorts);

const id = (n: number) => `01000000000000000000000${String(n).padStart(3, '0')}`;
const ids = { projectId: id(1), templateId: id(2), castId: id(3), timelineId: id(4), artifactId: id(5) };
const slotId = (index: number) => id(100 + index);
const shotId = (index: number) => id(200 + index);
const assetId = (index: number) => id(300 + index);

/** A 13-slot cast as the tool returns it: an empty first slot, six unsure slots and three worth a second look. */
function castResult() {
  const slots = Array.from({ length: 13 }, (_, index) => ({
    slotId: slotId(index),
    shotId: index === 0 ? null : shotId(index),
    assetId: index === 0 ? null : assetId(index),
    confidence: index === 0 ? null : index > 6 ? 0 : 1,
    needsRerank: index > 6,
    note: index === 0 ? ('noCandidates' as const) : null,
    alternates: [],
  }));
  const rerank = [7, 8, 9].map((index) => ({
    slotId: slotId(index),
    intent: { text: `A wide walk through the courtyard, part ${index}.`, shotType: null, motion: null },
    candidates: [0, 1, 2, 3].map((offset) => ({
      shotId: shotId(index + offset),
      description: `The creator crosses the courtyard past the fountain towards the gate, take ${offset + 1}, in warm evening light with people passing behind.`,
      ...(offset > 0
        ? { from: { slotId: slotId(index + offset), intent: 'A closer look at the same courtyard walk.' } }
        : {}),
    })),
  }));
  return {
    castId: ids.castId,
    configVersion: 'casting.v5',
    variants: [{ sequenceConfidence: 0.3, slots }],
    rerank,
    artifact: {
      id: ids.artifactId,
      mediaType: 'application/json',
      bytes: 15_643,
      summary: `Cast ${ids.castId}: 1 variant(s) of 13 slots.`,
    },
  };
}

it('offers timeline.assemble after the cast, so the step finishes without a tool search', async () => {
  const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
  try {
    const tools = root.container.resolve(ToolRegistryToken);
    const live = root.container.resolve(SkillRegistryToken).get('timeline.librarian')!;
    // Verification reads stored timelines; this test exercises the unchanged prompt, route and schemas.
    const skill = { ...live, verify: async () => ok({ verdict: 'pass' as const }), card: undefined };
    const skills = unwrap(
      createSkillRegistry([defineSkillModule({ id: 'timeline', skills: [skill] })], tools),
    );
    const cast = {
      projectId: ids.projectId,
      template: { id: ids.templateId },
      mode: 'template',
      variants: 1,
    };
    const outputs: Record<string, unknown> = {
      'timeline.cast': castResult(),
      'timeline.assemble': {
        castId: ids.castId,
        timelineIds: [ids.timelineId],
        revisions: [1],
        lowConfidence: 6,
      },
    };
    for (const [name, value] of Object.entries(outputs)) {
      const checked = tools.resolve(name)!.spec.output.safeParse(value);
      expect(checked.success, `${name}: ${JSON.stringify(checked)}`).toBe(true);
    }
    const offers: string[][] = [];
    const models = createScriptedModelClient((request, turn) => {
      if (!request.system?.includes('# Skill: timeline.librarian'))
        return turn === 0
          ? {
              toolCalls: [
                {
                  name: 'updatePlan',
                  arguments: {
                    steps: [
                      {
                        text: 'Pick the clips for the template.',
                        skill: 'timeline.librarian',
                        input: { projectId: ids.projectId, templateId: ids.templateId },
                      },
                    ],
                  },
                },
              ],
            }
          : { text: 'Finished.' };
      const offered = request.tools?.map((tool) => tool.name) ?? [];
      offers.push(offered);
      const answered = (name: string) => {
        const message = request.messages.findLast((m) => m.role === 'tool' && m.toolName === name);
        return message?.role === 'tool' ? String(message.content) : undefined;
      };
      // No findTools: like the 4B, this model calls what the request offers or has nothing to call.
      if (answered('timeline_assemble')?.includes(ids.timelineId))
        return {
          toolCalls: [
            {
              id: 'hand-off',
              name: 'handOff',
              arguments: {
                templateId: ids.templateId,
                timelineIds: [ids.timelineId],
                revisions: [1],
                lowConfidenceSlots: 6,
                reranked: 0,
              },
            },
          ],
        };
      if (answered('timeline_cast') !== undefined)
        return offered.includes('timeline_assemble')
          ? { toolCalls: [{ id: 'assemble', name: 'timeline_assemble', arguments: cast }] }
          : { text: 'Nothing offered makes the timeline.' };
      return { toolCalls: [{ id: 'cast', name: 'timeline_cast', arguments: cast }] };
    });
    const log = createMemoryEventLogStore();
    const executed: string[] = [];
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
        conversationId: 'librarian-budget',
        projectId: ids.projectId,
        message: 'Make a video with my template “Courtyard reel”',
      }),
    );
    const events = unwrap(await log.read(result.runId));
    expect(
      result.status,
      JSON.stringify([offers, events.filter((event) => event.type === 'run.failed')]),
    ).toBe('completed');
    expect(executed).toEqual(['timeline.cast', 'timeline.assemble']);
    // The request that follows the cast carries the tool that returns the handoff's timelines.
    expect(offers[0]).toContain('timeline_cast');
    expect(offers[1]).toContain('timeline_assemble');
    const calls = events.flatMap((event) => (event.type === 'tool.requested' ? [event.payload.tool] : []));
    expect(calls).not.toContain('findTools');
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

it('gives the Librarian’s step a settler that reads the stored timelines', async () => {
  const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
  try {
    const skills = root.container.resolve(SkillRegistryToken);
    const settle = flowExtensionDeps(root.container, skills, () => true).flowExtensions?.settlers?.[
      'timeline.librarian'
    ];
    expect(settle).toBeTypeOf('function');
    const signal = new AbortController().signal;
    // Nothing assembled, and an assembly whose timeline is not in the store: nothing to settle, the run fails as it did.
    expect(await settle!([], signal)).toEqual(ok(undefined));
    const assembled = { tool: 'timeline.assemble', input: {}, output: { timelineIds: [ids.timelineId] } };
    expect(await settle!([assembled], signal)).toEqual(ok(undefined));
  } finally {
    await root.container.dispose();
  }
});
