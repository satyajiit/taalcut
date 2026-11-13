// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Catalogue names do not cover the planning, reader and skill handoff schemas on the wire. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineError, ok, unwrap, type ModelModuleId } from '@taalcut/core';
import { createAgent, createMemoryEventLogStore, createScriptedModelClient, parseSoul } from '@taalcut/agent';
import {
  EDIT_CHAT_SESSION,
  EDIT_DESIGN_SESSION,
  GATE_DEMO_FIXTURES,
  GATE_DEMO_SESSION,
  GATE_AGENT,
  MAKE_FLOW_SESSION,
  OFFER_META_TOOLS,
  recordedSkillSteps,
  type RecordedSkillStep,
} from '@taalcut/gate-demo';
import {
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  disableNetwork,
  type ModelRequest,
} from '@taalcut/models';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelProfilesToken, ToolRegistryToken } from '../src/shared/tokens';
import { SkillRegistryToken } from '../src/utility/roots/agent-flows';
import { moduleContextWindow } from '../src/utility/roots/model-windows';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { SOUL, testAgent, testConfig } from './helpers/roots';

const Captured = defineError('test.meta_snapshot_complete', { retryable: false });
const PLACEHOLDER = '__pi_deferred_placeholder__';
const isMeta = (name: string) => OFFER_META_TOOLS.has(name) && name !== PLACEHOLDER;
interface WireTool {
  name: string;
  description?: string;
  eager_input_streaming?: boolean;
  input_schema: unknown;
  cache_control?: unknown;
}
/** The real SDK performs its toolJsonSchema conversion and Anthropic projection; fetch stops at this boundary. */
async function wireTools(request: ModelRequest): Promise<WireTool[]> {
  let tools: WireTool[] | undefined;
  const client = createModelClient({
    runtime: createModelRuntime({ builtinProviders: ['anthropic'] }),
    credentials: createStaticCredentialProvider({
      anthropic: { kind: 'api_key', secret: 'schema-fixture', source: 'test' },
    }),
    callLog: { record: async () => ok(undefined) },
    selector: { resolve: (module) => ok({ module, choices: [GATE_AGENT] }) },
    retry: { maxRetries: 0 },
    fetch: async (_url, init) => {
      tools = (JSON.parse(String(init?.body)) as { tools: WireTool[] }).tools;
      return new Response(
        JSON.stringify({ type: 'error', error: { type: 'schema_capture', message: 'Request captured.' } }),
        { status: 400 },
      );
    },
  });
  expect((await client.complete(request)).ok).toBe(false);
  expect(tools).toBeDefined();
  return tools!.filter((tool) => isMeta(tool.name)).map(({ cache_control: _mark, ...tool }) => tool);
}

afterEach(() => {
  closeAllPorts();
  vi.unstubAllEnvs();
});

it.each([GATE_DEMO_SESSION, MAKE_FLOW_SESSION, EDIT_CHAT_SESSION, EDIT_DESIGN_SESSION])(
  'derives actual planning and skill meta schemas for $name',
  async (session) => {
    vi.stubEnv('TAALCUT_TEST_RECORDED_MODELS', GATE_DEMO_FIXTURES);
    const guard = disableNetwork();
    let root: ReturnType<typeof testAgent> | undefined;
    try {
      root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
      const container = root.container;
      unwrap(await container.resolve(ModelProfilesToken).load());
      const tools = container.resolve(ToolRegistryToken);
      const skills = container.resolve(SkillRegistryToken);
      const steps = new Map(recordedSkillSteps(session).map((step) => [step.index, step]));
      const tape = JSON.parse(readFileSync(join(GATE_DEMO_FIXTURES, session.cassette), 'utf8')) as {
        interactions: { request: { body: { tools?: WireTool[] } | null } }[];
      };
      const cache = new Map<string, WireTool[]>();
      const offers: Record<number, WireTool[]> = {};
      async function capture(stage: 'planning' | 'plain' | 'skill', step?: RecordedSkillStep) {
        const key = JSON.stringify([stage, step?.skill, step?.input]);
        const known = cache.get(key);
        if (known) return known;
        let captured: ModelRequest | undefined;
        const models = createScriptedModelClient((request, turn) => {
          if (stage !== 'planning' && turn === 0)
            return {
              toolCalls: [
                {
                  name: 'updatePlan',
                  arguments: {
                    steps: [
                      {
                        text: 'Inspect the current request schemas.',
                        ...(step ? { skill: step.skill, input: step.input } : {}),
                      },
                    ],
                  },
                },
              ],
            };
          captured = request;
          // Stop after capturing the real fitted request, before any domain action or skill verification.
          return { error: Captured() };
        });
        const agent = createAgent({
          tools,
          skills,
          models,
          log: createMemoryEventLogStore(),
          soul: parseSoul(SOUL),
          contextWindow: (module) => moduleContextWindow(container)(module as ModelModuleId),
          settings: { autonomy: 'autopilot', budget: {} },
        });
        await agent.run({
          conversationId: `meta-${session.name}-${cache.size}`,
          message: 'Inspect the recorded request.',
        });
        expect(captured, `${stage} ${step?.skill ?? ''}: reached the actual request`).toBeDefined();
        cache.set(key, await wireTools(captured!));
        return cache.get(key)!;
      }
      for (const [index, row] of tape.interactions.entries()) {
        const recorded = (row.request.body?.tools ?? []).filter((tool) => isMeta(tool.name));
        if (recorded.length === 0) continue;
        const step = steps.get(index);
        const stage = step
          ? 'skill'
          : recorded.some((tool) => tool.name === 'startFlow')
            ? 'planning'
            : 'plain';
        offers[index] = await capture(stage, step);
        if (!process.env.TAALCUT_REFRESH_OFFERS)
          expect(
            recorded.map(({ cache_control: _mark, ...tool }) => tool),
            `${session.name}#${index}`,
          ).toEqual(offers[index]);
      }
      const out = process.env.TAALCUT_REFRESH_OFFERS;
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, `${session.name}.meta.json`), `${JSON.stringify(offers, null, 2)}\n`);
      }
      expect(guard.blocked).toEqual([]);
    } finally {
      try {
        await root?.container.dispose();
      } finally {
        guard.restore();
      }
    }
  },
);
