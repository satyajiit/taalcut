// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-F1 acceptance: the same prompt runs on two providers through one
 * interface, and each call reports tokens and cost. pi-ai's real OpenAI
 * (Responses) and Anthropic (Messages) code paths talk to a local mock server
 * that streams their wire formats.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  parseToolCall,
  toolJsonSchema,
  type ChatMessage,
  type ModelChoice,
  type ToolSpec,
} from '@taalcut/models';
import {
  ANTHROPIC_KEY,
  collect,
  createHarness,
  expectedCost,
  OPENAI_KEY,
  type Harness,
} from './support/harness';

const PROMPT: ChatMessage[] = [{ role: 'user', content: 'Describe the first shot in one line.' }];
const OPENAI: ModelChoice = { provider: 'openai', model: 'gpt-5.4' };
const ANTHROPIC: ModelChoice = { provider: 'anthropic', model: 'claude-sonnet-5' };

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
});

describe('one interface, two providers', () => {
  it('runs the same prompt on OpenAI and Anthropic and reports tokens and cost for each call', async () => {
    h.server.script('openai', { kind: 'reply', text: 'A drone shot over a beach at sunrise.' });
    h.server.script('anthropic', { kind: 'reply', text: 'Sunrise drone pass over the beach.' });

    for (const target of [OPENAI, ANTHROPIC]) {
      const events = await collect(
        h.client.stream({ module: 'agent', target, system: 'Be brief.', messages: PROMPT }),
      );
      const types = events.map((e) => e.type);
      expect(types[0]).toBe('start');
      expect(types).toContain('text_delta');
      expect(types.slice(-2)).toEqual(['usage', 'done']);

      const done = events.at(-1);
      if (done?.type !== 'done') throw new Error('expected done');
      const { result } = done;
      expect(result.provider).toBe(target.provider);
      expect(result.model).toBe(target.model);
      expect(result.text.length).toBeGreaterThan(10);
      expect(result.stopReason).toBe('stop');
      expect(result.usage).toMatchObject({ inputTokens: 1000, outputTokens: 300, cachedInputTokens: 200 });
      const cost = expectedCost(h.runtime, target.provider, target.model, {
        input: 1000,
        output: 300,
        cached: 200,
      });
      expect(cost).toBeGreaterThan(0);
      expect(result.usage.costUsd).toBeCloseTo(cost, 10);
      expect(
        events
          .filter((e) => e.type === 'text_delta')
          .map((e) => (e.type === 'text_delta' ? e.delta : ''))
          .join(''),
      ).toBe(result.text);
    }

    expect(h.callLog.records).toHaveLength(2);
    const [openaiCall, anthropicCall] = h.callLog.records;
    expect(openaiCall).toMatchObject({
      module: 'agent',
      provider: 'openai',
      model: 'gpt-5.4',
      outcome: 'ok',
      local: false,
      attempt: 1,
    });
    expect(anthropicCall).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      outcome: 'ok',
      inputTokens: 1000,
    });
    expect(openaiCall?.bytesSent).toBe(h.server.requests[0]?.bytes);
    expect(anthropicCall?.bytesSent).toBe(h.server.requests[1]?.bytes);
    expect(openaiCall?.bytesReceived).toBeGreaterThan(0);
    expect(openaiCall?.costUsd).toBeGreaterThan(0);

    // The secret came from the CredentialProvider and went only where it belongs.
    expect(h.server.requests[0]?.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(h.server.requests[1]?.headers['x-api-key']).toBe(ANTHROPIC_KEY);
    expect(JSON.stringify(h.callLog.records)).not.toContain('sk-');
  });

  it('complete() returns the same result without iterating', async () => {
    const result = await h.client.complete({ module: 'agent', target: ANTHROPIC, messages: PROMPT });
    expect(result.ok && result.value.text).toBe('Hello from the mock anthropic server.');
  });
});

describe('reasoning levels', () => {
  it("passes pi-ai's reasoning setting through and streams reasoning deltas", async () => {
    h.server.script('openai', { kind: 'reply', reasoning: 'The reference opens wide.', text: 'Wide shot.' });
    h.server.script('anthropic', { kind: 'reply', reasoning: 'Look at frame one.', text: 'Close-up.' });

    const openai = await collect(
      h.client.stream({ module: 'agent', target: { ...OPENAI, reasoning: 'high' }, messages: PROMPT }),
    );
    const anthropic = await collect(
      h.client.stream({ module: 'agent', target: ANTHROPIC, reasoning: 'low', messages: PROMPT }),
    );

    expect(h.server.requests[0]?.body.reasoning).toMatchObject({ effort: 'high' });
    expect(JSON.stringify(h.server.requests[1]?.body)).toMatch(/"thinking"|"output_config"/);
    expect(openai.some((e) => e.type === 'reasoning_delta')).toBe(true);
    expect(anthropic.some((e) => e.type === 'reasoning_delta')).toBe(true);
    const start = openai[0];
    expect(start?.type === 'start' && start.reasoning).toBe('high');
    const done = anthropic.at(-1);
    expect(done?.type === 'done' && done.result.message.parts.map((p) => p.type)).toEqual([
      'reasoning',
      'text',
    ]);
  });

  it('sends no reasoning effort when the level is off', async () => {
    await h.client.complete({ module: 'agent', target: { ...OPENAI, reasoning: 'off' }, messages: PROMPT });
    expect(h.server.requests[0]?.body.reasoning).toEqual({ effort: 'none' });
  });
});

describe('tool calling', () => {
  const findClips: ToolSpec = {
    name: 'find_clips',
    description: 'Search the library for clips',
    parameters: z.object({ query: z.string().min(1), limit: z.number().int().max(50).optional() }),
  };

  it('sends zod schemas as JSON Schema and returns typed tool calls, then continues the conversation', async () => {
    for (const [route, target] of [
      ['openai', OPENAI],
      ['anthropic', ANTHROPIC],
    ] as const) {
      h.server.script(route, {
        kind: 'reply',
        toolCall: { name: 'find_clips', args: { query: 'beach', limit: 5 } },
      });
      const first = await h.client.complete({
        module: 'agent',
        target,
        messages: PROMPT,
        tools: [findClips],
      });
      if (!first.ok) throw new Error(first.error.code);
      expect(first.value.stopReason).toBe('tool_use');
      const call = first.value.toolCalls[0]!;
      expect(call.name).toBe('find_clips');
      const args = parseToolCall(findClips, call);
      expect(args.ok && args.value).toEqual({ query: 'beach', limit: 5 });

      h.server.script(route, { kind: 'reply', text: 'Found five beach clips.' });
      const second = await h.client.complete({
        module: 'agent',
        target,
        messages: [
          ...PROMPT,
          first.value.message,
          { role: 'tool', toolCallId: call.id, toolName: call.name, content: '5 clips' },
        ],
        tools: [findClips],
      });
      expect(second.ok && second.value.text).toBe('Found five beach clips.');
    }
    const [openaiFirst, openaiSecond, anthropicFirst, anthropicSecond] = h.server.requests;
    const schema = toolJsonSchema(findClips);
    // pi-ai 1.4.0 declares Responses tools in place, in an `additional_tools` input item, as Codex does.
    const declared = (openaiFirst?.body.input as { type?: string; tools?: { parameters: unknown }[] }[]).find(
      (item) => item.type === 'additional_tools',
    );
    expect(declared?.tools?.[0]?.parameters).toEqual(schema);
    expect((anthropicFirst?.body.tools as { input_schema: unknown }[])[0]?.input_schema).toMatchObject({
      properties: schema.properties,
    });
    expect(JSON.stringify(openaiSecond?.body.input)).toContain('function_call_output');
    expect(JSON.stringify(anthropicSecond?.body.messages)).toContain('tool_result');
  });

  it('rejects arguments that break the schema, as a value', () => {
    const bad = parseToolCall(findClips, { id: '1', name: 'find_clips', arguments: { query: '' } });
    expect(!bad.ok && bad.error.code).toBe('core.validation');
    const wrong = parseToolCall(findClips, { id: '1', name: 'other', arguments: {} });
    expect(!wrong.ok && wrong.error.params).toEqual({ field: 'name' });
  });
});

describe('cancellation', () => {
  it('stops on abort, reports core.cancelled and logs the call as cancelled', async () => {
    h.server.script('openai', { kind: 'stall' });
    const controller = new AbortController();
    const stream = h.client.stream({
      module: 'agent',
      target: OPENAI,
      messages: PROMPT,
      signal: controller.signal,
    });
    const seen: string[] = [];
    for await (const event of stream) {
      seen.push(event.type);
      if (event.type === 'text_delta') controller.abort();
    }
    const result = await stream.result();
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(seen.at(-1)).toBe('error');
    expect(seen).not.toContain('fallback');
    expect(h.callLog.records[0]).toMatchObject({ outcome: 'cancelled', errorCode: 'core.cancelled' });
  });
});
