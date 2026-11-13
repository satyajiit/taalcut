// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The embedded runtime's grammar refuses a large array bound. 0.1.0-beta.1's installed run: `audio.critique` takes
 * up to 2,000 cuts, and every on-device request that offered it came back "400: Failed to initialize samplers:
 * failed to parse grammar", which ended the make at the reviewer's first turn. The schema sent to that runtime
 * leaves such a bound out; the call is still held to the tool's own schema.
 */
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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
  parseToolCall,
  toolJsonSchema,
  type FetchFn,
  type ModelChoice,
  type ToolSpec,
} from '@taalcut/models';
import { EMBEDDED_MAX_ITEMS, embeddedToolSchema, toPiTools } from '../src/client/tools';
import { TEST_CREDENTIALS } from './support/harness';

const QWEN: ModelChoice = { provider: 'on-device', model: 'qwen3.5-4b' };

/** The shape that failed: a long list of bounded numbers beside ordinary fields. */
const critique: ToolSpec = {
  name: 'audio_critique',
  description: 'Scores a mix.',
  parameters: z.object({
    source: z.object({ assetId: z.string().max(26) }),
    cuts: z.array(z.number().min(0).max(3600)).max(2000).optional(),
    notes: z
      .array(z.object({ words: z.array(z.string()).max(5000), at: z.number() }))
      .max(EMBEDDED_MAX_ITEMS),
  }),
};

const answer = `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'qwen3.5-4b', choices: [{ index: 0, delta: { content: 'Done.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;

describe('a tool schema for the embedded runtime', () => {
  it('leaves out an array bound its grammar refuses, at any depth, and nothing else', () => {
    const full = toolJsonSchema(critique) as { properties: Record<string, Record<string, unknown>> };
    expect(full.properties.cuts).toMatchObject({ maxItems: 2000 });
    const sent = embeddedToolSchema(full) as typeof full;
    expect(sent.properties.cuts).not.toHaveProperty('maxItems');
    // A bound it can hold stays, and so does every other part of the schema.
    expect(sent.properties.notes).toMatchObject({ maxItems: EMBEDDED_MAX_ITEMS });
    expect(sent.properties.notes!.items).not.toHaveProperty('properties.words.maxItems');
    expect(sent.properties.cuts!.items).toEqual({ type: 'number', minimum: 0, maximum: 3600 });
    expect(sent.properties.source).toEqual(full.properties.source);
    expect({ ...sent, properties: undefined }).toEqual({ ...full, properties: undefined });
    // The source schema is not touched, and other providers get it whole.
    expect(toolJsonSchema(critique)).toEqual(full);
    expect(toPiTools([critique])[0]!.parameters).toEqual(full);
    expect(toPiTools([critique], true)[0]!.parameters).toEqual(sent);
  });

  it('still holds a call to the whole schema', () => {
    const cuts = Array.from({ length: 2001 }, (_, index) => index);
    const call = {
      id: 'c',
      name: 'audio_critique',
      arguments: { source: { assetId: 'a' }, cuts, notes: [] },
    };
    expect(parseToolCall(critique, call).ok).toBe(false);
    expect(parseToolCall(critique, { ...call, arguments: { ...call.arguments, cuts: [1, 2] } }).ok).toBe(
      true,
    );
  });

  it('is what an on-device request carries', async () => {
    const bodies: { tools?: { function: { parameters: { properties: Record<string, unknown> } } }[] }[] = [];
    const fetch: FetchFn = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as (typeof bodies)[number]);
      return new Response(answer, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const local = createLocalRuntime({
      spec: llamaCppRuntimeSpec('recommended'),
      installer: createMemoryComponentInstaller(),
      driver: createFakeLocalRuntimeDriver(() => ({
        kind: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:9/v1',
      })),
      backends: ['metal', 'mlx', 'cpu'],
    });
    const runtime = createModelRuntime({ builtinProviders: [] });
    const attached = attachLocalRuntime(local, [runtime]);
    await local.ensureInstalled('recommended');
    expect((await local.start()).ok).toBe(true);
    const client = createModelClient({
      runtime,
      credentials: createStaticCredentialProvider(TEST_CREDENTIALS),
      callLog: createMemoryCloudCallSink(),
      localAdapter: attached.localAdapter,
      fetch,
      retry: { maxRetries: 0 },
      selector: { resolve: (module) => ok({ module, choices: [QWEN] }) },
    });
    const result = await client.complete({
      module: 'agent',
      target: QWEN,
      messages: [{ role: 'user', content: 'Review the mix.' }],
      tools: [critique],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const properties = bodies[0]!.tools![0]!.function.parameters.properties;
    expect(properties.cuts).toEqual({ type: 'array', items: { type: 'number', minimum: 0, maximum: 3600 } });
    await local.stop();
  });
});
