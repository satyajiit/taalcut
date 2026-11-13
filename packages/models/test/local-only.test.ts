// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Local only in the ModelClient and the router classifier (P2-X2, G9): cloud
 * models are refused before anything is sent. A recording fetch shows that no
 * request leaves, no cloud-call row is written and no fallback is reported.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createClassifier,
  ROUTER_CLASSIFIER_CHAIN,
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  type ChatMessage,
  type FetchFn,
  type ModelChoice,
  type ModelEvent,
  type ModelSelector,
} from '@taalcut/models';
import { startMockProviderServer, type MockProviderServer } from '@taalcut/models/test-support';
import { collect, TEST_CREDENTIALS } from './support/harness';

const PROMPT: ChatMessage[] = [{ role: 'user', content: 'Plan the cut.' }];
const CLOUD: ModelChoice = { provider: 'openai', model: 'gpt-5.4' };
const LOCAL: ModelChoice = { provider: 'mock-local', model: 'tiny' };

let server: MockProviderServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const selectorOf = (...choices: ModelChoice[]): ModelSelector => ({
  resolve: (module) => ({ ok: true, value: { module, choices } }),
});

async function setup(chain: ModelChoice[], localOnly: { on: boolean }) {
  server = await startMockProviderServer();
  const sent: string[] = [];
  const fetch: FetchFn = (input, init) => {
    sent.push(String(input instanceof Request ? input.url : input));
    return globalThis.fetch(input, init);
  };
  const runtime = createModelRuntime({
    baseUrlOverrides: { openai: `${server.url}/v1`, anthropic: server.url },
    endpoints: [
      { id: 'mock-local', name: 'Mock local', baseUrl: `${server.url}/v1`, models: [{ id: 'tiny' }] },
    ],
  });
  const callLog = createMemoryCloudCallSink();
  const client = createModelClient({
    runtime,
    credentials: createStaticCredentialProvider(TEST_CREDENTIALS),
    callLog,
    selector: selectorOf(...chain),
    fetch,
    retry: { maxRetries: 0 },
    localOnly: () => localOnly.on,
  });
  return { client, callLog, sent, runtime, fetch };
}

const types = (events: ModelEvent[]) => events.map((e) => e.type).filter((t) => t !== 'text_delta');

describe('Local only in the ModelClient', () => {
  it('refuses a cloud-only chain before anything is sent', async () => {
    const h = await setup([CLOUD], { on: true });
    const events = await collect(h.client.stream({ module: 'agent', messages: PROMPT }));
    expect(types(events)).toEqual(['error']);
    const error = events[0]?.type === 'error' ? events[0].error : undefined;
    expect(error).toMatchObject({ code: 'core.local_only', params: { what: 'model' } });
    expect(error?.fix).toMatchObject({ command: 'go.privacy' });
    expect(h.sent).toEqual([]);
    expect(h.callLog.records).toEqual([]);
  });

  it('runs the model on this Mac in a mixed chain, with no fallback from the cloud one', async () => {
    const h = await setup([CLOUD, LOCAL], { on: true });
    const events = await collect(h.client.stream({ module: 'agent', messages: PROMPT }));
    expect(types(events)).not.toContain('fallback');
    const done = events.at(-1);
    expect(done?.type === 'done' && done.result).toMatchObject({ provider: 'mock-local', local: true });
    expect(h.sent.every((url) => url.startsWith(server!.url))).toBe(true);
    expect(h.callLog.records.map((r) => [r.provider, r.local])).toEqual([['mock-local', true]]);
  });

  it('refuses an explicit cloud target', async () => {
    const h = await setup([LOCAL], { on: true });
    const result = await h.client.complete({ module: 'agent', messages: PROMPT, target: CLOUD });
    expect(!result.ok && result.error.code).toBe('core.local_only');
    expect(h.sent).toEqual([]);
  });

  it('reads the switch on every call: off again, the cloud model answers', async () => {
    const localOnly = { on: true };
    const h = await setup([CLOUD], localOnly);
    expect((await h.client.complete({ module: 'agent', messages: PROMPT })).ok).toBe(false);
    localOnly.on = false;
    const result = await h.client.complete({ module: 'agent', messages: PROMPT });
    expect(result.ok && result.value.provider).toBe('openai');
    expect(h.callLog.records.map((r) => r.provider)).toEqual(['openai']);
  });
});

describe('Local only in the router classifier', () => {
  it('refuses its cloud classifiers without a request', async () => {
    const sent: unknown[] = [];
    const classifier = createClassifier({
      runtime: createModelRuntime(),
      credentials: createStaticCredentialProvider({}),
      callLog: createMemoryCloudCallSink(),
      chain: ROUTER_CLASSIFIER_CHAIN.slice(0, 2),
      fetch: async (input) => {
        sent.push(input);
        return new Response('{}');
      },
      localOnly: () => true,
    });
    const result = await classifier.classify({
      state: { message: 'cut the silences' },
      questions: { tool: { type: 'bool', instructions: 'A tool?', yes: 'yes', no: 'no' } },
    });
    expect(!result.ok && result.error.code).toBe('core.local_only');
    expect(sent).toEqual([]);
  });

  it('still routes on this Mac with the rules router (P3-B11), sending nothing', async () => {
    const sent: unknown[] = [];
    const classifier = createClassifier({
      runtime: createModelRuntime(),
      credentials: createStaticCredentialProvider({}),
      callLog: createMemoryCloudCallSink(),
      fetch: async (input) => {
        sent.push(input);
        return new Response('{}');
      },
      localOnly: () => true,
    });
    const result = await classifier.classify({
      state: { message: 'trim the head of this clip' },
      questions: {
        family: {
          type: 'choice',
          instructions: 'Which family?',
          options: { none: 'No tool', timeline: 'Edits the timeline', library: 'Finds media' },
        },
      },
    });
    expect(result).toMatchObject({ ok: true, value: { provider: 'taalcut', local: true } });
    expect(sent).toEqual([]);
  });

  it('with Local only off and an empty chain, still says there is no model', async () => {
    const classifier = createClassifier({
      runtime: createModelRuntime(),
      credentials: createStaticCredentialProvider({}),
      callLog: createMemoryCloudCallSink(),
      chain: [],
      localOnly: () => false,
    });
    const result = await classifier.classify({ state: {}, questions: {} });
    expect(!result.ok && result.error.code).toBe('models.no_model_for_module');
  });
});
