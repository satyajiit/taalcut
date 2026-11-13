// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The real Librarian schemas must leave usable output room on the recommended Mac's 4B runtime. */
import { afterEach, expect, it } from 'vitest';
import { defineSkillModule, newId, ok, unwrap } from '@taalcut/core';
import {
  createAgent,
  createMemoryEventLogStore,
  createScriptedModelClient,
  createSkillRegistry,
  parseSoul,
} from '@taalcut/agent';
import { makeFlowTurn, viewOf } from '@taalcut/gate-demo';
import {
  attachLocalRuntime,
  createFakeLocalRuntimeDriver,
  createLocalRuntime,
  createMemoryCloudCallSink,
  createMemoryComponentInstaller,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  llamaCppRuntimeSpec,
  type FetchFn,
  type ModelRequest,
} from '@taalcut/models';
import { ToolRegistryToken } from '../src/shared/tokens';
import { SkillRegistryToken } from '../src/utility/roots/agent-flows';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { SOUL, testAgent, testConfig } from './helpers/roots';
import { castingBudgetFixture } from './helpers/casting-budget';

afterEach(closeAllPorts);

const WINDOW = 12_288;
const PROMPT_BUDGET = 6_963;
type RequestBlock = Exclude<Parameters<typeof viewOf>[0]['messages'][number]['content'], string>[number];

/** Exercise the production adapter's cap calculation; this fetch never opens a connection. */
async function wireCaps(requests: readonly ModelRequest[]): Promise<number[]> {
  const caps: number[] = [];
  const endpoint = 'http://127.0.0.1:9/v1';
  const fetch: FetchFn = async (input, init) => {
    expect(String(input)).toBe(`${endpoint}/chat/completions`);
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    caps.push(Number(sent.max_tokens ?? sent.max_completion_tokens));
    const answer = {
      id: 'budget-proof',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'qwen3.5-4b',
      choices: [{ index: 0, delta: { content: 'fixture' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    return new Response(`data: ${JSON.stringify(answer)}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const local = createLocalRuntime({
    spec: llamaCppRuntimeSpec('recommended'),
    installer: createMemoryComponentInstaller(),
    driver: createFakeLocalRuntimeDriver(() => ({ kind: 'openai-compatible', baseUrl: endpoint })),
    backends: ['metal', 'cpu'],
  });
  const runtime = createModelRuntime({ builtinProviders: [] });
  const attached = attachLocalRuntime(local, [runtime]);
  try {
    unwrap(await local.ensureInstalled('recommended'));
    unwrap(await local.start());
    const client = createModelClient({
      runtime,
      credentials: createStaticCredentialProvider({}),
      callLog: createMemoryCloudCallSink(),
      localAdapter: attached.localAdapter,
      fetch,
      retry: { maxRetries: 0 },
    });
    for (const request of requests)
      unwrap(
        await client.complete({
          ...request,
          target: { provider: 'on-device', model: 'qwen3.5-4b' },
        }),
      );
    expect(caps).toHaveLength(requests.length);
    return caps;
  } finally {
    await local.stop();
    attached.detach();
  }
}

it.each([
  { startWithTemplate: true, maxOutputTokens: undefined },
  { startWithTemplate: true, maxOutputTokens: 512 },
  { startWithTemplate: false, maxOutputTokens: undefined },
])(
  'fits real casting schemas (template start $startWithTemplate, output cap $maxOutputTokens)',
  async ({ startWithTemplate, maxOutputTokens }) => {
    const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
    try {
      const tools = root.container.resolve(ToolRegistryToken);
      const skills = root.container.resolve(SkillRegistryToken);
      const projectId = newId<'Project'>();
      const templateId = newId<'Template'>();
      let skillTurn = 0;
      const models = createScriptedModelClient((request) => {
        if (!request.system?.includes('# Skill: timeline.librarian')) {
          expect(startWithTemplate).toBe(false);
          if (tools.resolve('shorts.generate')) {
            expect(request.system).toContain('# Tool catalogue');
            expect(request.system).toContain('shorts.generate');
          }
          return {
            toolCalls: [
              {
                name: 'updatePlan',
                arguments: {
                  steps: [
                    {
                      text: 'Cast the template and assemble one reel',
                      skill: 'timeline.librarian',
                      input: { projectId, templateId },
                    },
                  ],
                },
              },
            ],
          };
        }
        const query = ['timeline.cast', 'timeline.assemble'][skillTurn++];
        return query
          ? { toolCalls: [{ name: 'findTools', arguments: { query } }] }
          : { text: 'The fixture does not execute domain tools.' };
      });
      const log = createMemoryEventLogStore();
      const agent = createAgent({
        models,
        tools,
        skills,
        log,
        soul: parseSoul(SOUL),
        contextWindow: () => WINDOW,
        settings: {
          autonomy: 'autopilot',
          localOnly: true,
          budget: {},
          ...(maxOutputTokens ? { loop: { maxOutputTokens } } : {}),
        },
      });
      const result = unwrap(
        await agent.run({
          conversationId: 'budget',
          projectId,
          message: 'Make one reel from my footage with this template.',
          ...(startWithTemplate ? { start: { path: 'template' as const, templateId } } : {}),
        }),
      );
      const events = unwrap(await log.read(result.runId));
      expect(events.find((event) => event.type === 'skill.entered')?.payload).toMatchObject({
        skill: 'timeline.librarian',
        input: { projectId, templateId },
      });
      const compacted = events.filter((event) => event.type === 'context.compacted');
      expect(compacted.length).toBeGreaterThan(0);
      for (const event of compacted) {
        expect(event.payload).toMatchObject({ window: WINDOW, budgetTokens: PROMPT_BUDGET, fits: true });
        expect(event.payload.afterTokens).toBeLessThanOrEqual(PROMPT_BUDGET);
      }
      const requests = models.requests.filter((request) =>
        request.system?.includes('# Skill: timeline.librarian'),
      );
      expect(requests.length).toBeGreaterThanOrEqual(3);
      expect(requests[1]!.tools?.map((tool) => tool.name)).toContain('timeline_cast');
      expect(requests[2]!.tools?.map((tool) => tool.name)).toContain('timeline_assemble');
      for (const request of requests) {
        expect(request.tools?.map((tool) => tool.name)).toContain('handOff');
        expect(request.tools?.map((tool) => tool.name)).not.toContain('templates_planFromFormat');
      }
      const calls = events
        .filter((event) => event.type === 'tool.requested')
        .map((event) => event.payload.tool);
      expect(calls.every((name) => ['updatePlan', 'findTools'].includes(name))).toBe(true);
      for (const cap of await wireCaps(models.requests)) {
        if (maxOutputTokens) expect(cap).toBe(maxOutputTokens);
        else expect(cap).toBeGreaterThanOrEqual(1_024);
      }
    } finally {
      await root.container.dispose();
    }
  },
);

it.each([2, 3])(
  'reads %i bounded reranks from a 13-slot cast, assembles, and replays without prompt drift',
  async (count) => {
    const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
    try {
      const tools = root.container.resolve(ToolRegistryToken);
      const liveSkills = root.container.resolve(SkillRegistryToken);
      const librarian = liveSkills.get('timeline.librarian')!;
      const skills = unwrap(
        createSkillRegistry(
          [
            defineSkillModule({
              id: 'timeline',
              skills: [
                { ...librarian, verify: async () => ok({ verdict: 'pass' as const }), card: undefined },
              ],
            }),
          ],
          tools,
        ),
      );
      const projectId = newId<'Project'>(),
        templateId = newId<'Template'>(),
        timelineId = newId<'Timeline'>();
      const fixture = castingBudgetFixture();
      const rerank = fixture.rerank.slice(0, count);
      const cast = { ...fixture.cast, rerank };
      expect(tools.resolve('timeline.cast')!.spec.output.safeParse(cast).success).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(cast))).toBeLessThan(8 * 1024);
      let casts = 0,
        assembled = 0;
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
                          text: 'Cast and assemble the given template.',
                          skill: librarian.id,
                          input: { projectId, templateId },
                        },
                      ],
                    },
                  },
                ],
              }
            : { text: 'Assembled the reel.' };
        const answer = makeFlowTurn(
          viewOf({
            model: 'fixture',
            system: request.system,
            tools: request.tools?.map(({ name }) => ({ name })),
            messages: request.messages.map((message) =>
              message.role === 'assistant'
                ? {
                    role: 'assistant',
                    content: message.parts.flatMap<RequestBlock>((part) =>
                      part.type === 'tool_call'
                        ? [
                            {
                              type: 'tool_use',
                              id: part.call.id,
                              name: part.call.name,
                              input: part.call.arguments,
                            },
                          ]
                        : part.type === 'text'
                          ? [{ type: 'text', text: part.text }]
                          : [],
                    ),
                  }
                : message.role === 'tool'
                  ? {
                      role: 'user',
                      content: [
                        {
                          type: 'tool_result',
                          tool_use_id: message.toolCallId,
                          content: String(message.content),
                        },
                      ],
                    }
                  : { role: 'user', content: String(message.content) },
            ),
          }),
        );
        return {
          ...(answer.text ? { text: answer.text } : {}),
          ...(answer.toolCall
            ? { toolCalls: [{ name: answer.toolCall.name, arguments: answer.toolCall.args }] }
            : {}),
        };
      });
      const log = createMemoryEventLogStore();
      const agent = createAgent({
        models,
        tools,
        skills,
        log,
        soul: parseSoul(SOUL),
        contextWindow: () => WINDOW,
        settings: { autonomy: 'autopilot', localOnly: true, budget: {} },
        executor: {
          async execute(name, args, options) {
            const tool = tools.resolve(name)!;
            expect(tool.spec.input.safeParse(args).success).toBe(true);
            let value: unknown;
            if (tool.descriptor.name === 'timeline.cast') {
              casts++;
              value = cast;
            } else {
              expect(tool.descriptor.name).toBe('timeline.assemble');
              expect(args).toMatchObject({
                projectId,
                template: { id: templateId },
                rerank: rerank.map((slot) => ({
                  slotId: slot.slotId,
                  order: slot.candidates.map((candidate) => candidate.shotId),
                })),
              });
              assembled++;
              value = { timelineIds: [timelineId], revisions: [1], lowConfidence: 10 };
            }
            return ok({
              tool: tool.descriptor.name,
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
          conversationId: 'casting-budget',
          projectId,
          message: 'Make one reel from my footage with the given template. Preserve my selected shots.',
        }),
      );
      const events = unwrap(await log.read(result.runId));
      expect(
        result.status,
        JSON.stringify(
          events.filter(
            (event) =>
              event.type === 'run.failed' || event.type === 'tool.failed' || event.type === 'tool.requested',
          ),
        ),
      ).toBe('completed');
      expect(casts).toBe(1);
      expect(assembled).toBe(1);
      expect(events.filter((event) => event.type === 'tool.failed')).toEqual([]);
      const reads = events.flatMap((event) =>
        event.type === 'tool.requested' && event.payload.tool === 'readArtifact' ? [event.payload.input] : [],
      );
      expect(reads).toEqual(
        Array.from({ length: count }, (_, index) =>
          expect.objectContaining({ id: expect.stringMatching(/^result:/), path: `/rerank/${index}` }),
        ),
      );
      for (const event of events)
        if (event.type === 'context.compacted') {
          expect(event.payload.fits).toBe(true);
          expect(event.payload.budgetTokens).toBe(PROMPT_BUDGET);
          expect(event.payload.afterTokens).toBeLessThanOrEqual(PROMPT_BUDGET);
        }
      for (const request of models.requests)
        expect(
          request.messages.some(
            (message) =>
              message.role === 'user' && String(message.content).includes('Preserve my selected shots.'),
          ),
        ).toBe(true);
      expect(unwrap(await agent.replay(result.runId))).toMatchObject({ status: 'completed', promptDrift: 0 });
    } finally {
      await root.container.dispose();
    }
  },
);
