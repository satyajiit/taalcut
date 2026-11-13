// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * vision.describeFrame through the real ModelClient and pi-ai's real request
 * building, SSE parsing and pricing, with a scripted `fetch` in place of the
 * provider (the same seam record/replay cassettes use). The network is
 * disabled for the whole file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMemoryCloudCallSink,
  createModelClient,
  createStaticCredentialProvider,
  disableNetwork,
  type FetchFn,
  type NetworkGuard,
} from '@taalcut/models';
import { describeFrameOutputSchema, visionToolModule } from '@taalcut/vision';
import {
  FAKE_JPEG,
  fakeJobs,
  mutableSelector,
  OLLAMA_VL,
  testRuntime,
  testToolContext,
} from './helpers/fakes';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());

const sse = (data: unknown) => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;

/** An OpenAI Chat Completions stream, as OpenRouter and Ollama send it. */
function chatCompletionStream(model: string, text: string, usage: { input: number; output: number }): string {
  const chunk = (delta: object, finish: string | null = null) =>
    sse({
      id: 'c1',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
  return [
    chunk({ role: 'assistant', content: '' }),
    chunk({ content: text }),
    chunk({}, 'stop'),
    sse({
      id: 'c1',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [],
      usage: {
        prompt_tokens: usage.input,
        completion_tokens: usage.output,
        total_tokens: usage.input + usage.output,
      },
    }),
    sse('[DONE]'),
  ].join('');
}

interface Captured {
  url: string;
  body: { model: string; messages: { role: string; content: unknown }[] };
}

function scriptedFetch(model: string, text: string, captured: Captured[]): FetchFn {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    captured.push({ url, body: JSON.parse(String(init?.body)) as Captured['body'] });
    return new Response(chatCompletionStream(model, text, { input: 600, output: 80 }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
}

const input = { path: '/clip.mov', at: { value: 3, rate: 1 }, detail: 'normal' as const };

describe('describeFrame over pi-ai with a scripted provider', () => {
  it('cloud: sends the JPEG as an image part, prices the answer and logs one cloud call', async () => {
    const captured: Captured[] = [];
    const choice = { provider: 'openrouter', model: 'google/gemini-3.1-flash-lite' };
    const callLog = createMemoryCloudCallSink();
    const runtime = testRuntime();
    const models = createModelClient({
      runtime,
      credentials: createStaticCredentialProvider({
        openrouter: { kind: 'api_key', secret: 'sk-test-not-real', source: 'test' },
      }),
      callLog,
      selector: mutableSelector([choice]),
      fetch: scriptedFetch(choice.model, 'A cyclist crosses a sunny street.', captured),
    });
    const deps = { jobs: fakeJobs(), models, selector: mutableSelector([choice]), runtime };
    const tool = visionToolModule(deps).tools[0]!;
    expect(tool.sideEffect).toBe('external');

    const ctx = testToolContext();
    const result = await tool.run(input, ctx);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    expect(describeFrameOutputSchema.parse(result.value)).toMatchObject({
      description: 'A cyclist crosses a sunny street.',
      model: { provider: 'openrouter', model: 'google/gemini-3.1-flash-lite', local: false },
      uploadedTo: ['openrouter'],
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const user = captured[0]?.body.messages.find((m) => m.role === 'user');
    expect(user?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image_url',
          image_url: expect.objectContaining({
            url: `data:image/jpeg;base64,${FAKE_JPEG.toString('base64')}`,
          }),
        }),
      ]),
    );

    // pi-ai's price for this model: $0.25/M in, $1.5/M out.
    expect(ctx.usage[0]?.usd).toBeCloseTo((600 * 0.25 + 80 * 1.5) / 1e6, 9);
    expect(callLog.records).toHaveLength(1);
    expect(callLog.records[0]).toMatchObject({
      module: 'vision',
      provider: 'openrouter',
      local: false,
      outcome: 'ok',
    });
  });

  it('local: talks only to the loopback server and nothing is uploaded', async () => {
    const captured: Captured[] = [];
    const runtime = testRuntime();
    const selector = mutableSelector([OLLAMA_VL]);
    const models = createModelClient({
      runtime,
      credentials: createStaticCredentialProvider({}),
      callLog: createMemoryCloudCallSink(),
      selector,
      fetch: scriptedFetch(OLLAMA_VL.model, 'A dog on a sofa.', captured),
    });
    const tool = visionToolModule({ jobs: fakeJobs(), models, selector, runtime }).tools[0]!;
    expect(tool.sideEffect).toBe('read');

    const ctx = testToolContext();
    const result = await tool.run(input, ctx);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    expect(describeFrameOutputSchema.parse(result.value)).toMatchObject({
      description: 'A dog on a sofa.',
      model: { provider: 'ollama', local: true },
      uploadedTo: [],
    });
    expect(captured.map((c) => c.url)).toEqual(['http://127.0.0.1:11434/v1/chat/completions']);
    expect(ctx.usage[0]?.usd).toBe(0);
    expect(guard.blocked).toEqual([]);
  });
});
