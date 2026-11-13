// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A ModelClient wired to the mock provider server, with fakes for every port. */
import {
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  type CredentialProvider,
  type FetchFn,
  type LocalEndpoint,
  type MemoryCloudCallSink,
  type ModelClient,
  type ModelEvent,
  type ModelRuntime,
  type ModelSelector,
  type ModelStream,
  type ResolvedCredential,
} from '@taalcut/models';
import { startMockProviderServer, type MockProviderServer } from '@taalcut/models/test-support';

export const OPENAI_KEY = 'sk-test-openai-0123456789abcdef';
export const ANTHROPIC_KEY = 'sk-ant-test-0123456789abcdefghij';

export const TEST_CREDENTIALS: Readonly<Record<string, ResolvedCredential>> = {
  openai: { kind: 'api_key', secret: OPENAI_KEY, source: 'test' },
  anthropic: { kind: 'api_key', secret: ANTHROPIC_KEY, source: 'test' },
};

export interface Harness {
  readonly server: MockProviderServer;
  readonly runtime: ModelRuntime;
  readonly callLog: MemoryCloudCallSink;
  readonly client: ModelClient;
  close(): Promise<void>;
}

export interface HarnessOptions {
  readonly selector?: ModelSelector;
  readonly credentials?: CredentialProvider;
  readonly fetch?: FetchFn;
  /** Extra local endpoints; 'mock-local' (Chat Completions on the mock server) is always added. */
  readonly endpoints?: readonly LocalEndpoint[];
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const server = await startMockProviderServer();
  return { server, ...createClient(server.url, options), close: () => server.close() };
}

/**
 * The same client with its providers pointed at a port nothing listens on, so
 * only an injected fetch (a replaying cassette) can answer. Starts no server.
 */
export function createOfflineClient(fetch: FetchFn) {
  return createClient('http://127.0.0.1:9', { fetch });
}

function createClient(url: string, options: HarnessOptions) {
  const runtime = createModelRuntime({
    baseUrlOverrides: { openai: `${url}/v1`, anthropic: url },
    endpoints: [
      {
        id: 'mock-local',
        name: 'Mock local',
        baseUrl: `${url}/v1`,
        models: [{ id: 'tiny', reasoning: true }],
      },
      ...(options.endpoints ?? []),
    ],
  });
  const callLog = createMemoryCloudCallSink();
  const client = createModelClient({
    runtime,
    credentials: options.credentials ?? createStaticCredentialProvider(TEST_CREDENTIALS),
    callLog,
    ...(options.selector ? { selector: options.selector } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    retry: { maxRetries: 0 },
  });
  return { runtime, callLog, client };
}

export async function collect(stream: ModelStream): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/** Expected cost in USD from pi-ai's price table (USD per million tokens). */
export function expectedCost(
  runtime: ModelRuntime,
  provider: string,
  model: string,
  usage: { input: number; output: number; cached: number },
): number {
  const info = runtime.findModel(provider, model);
  if (!info) throw new Error(`No model ${provider}/${model}`);
  const { price } = info;
  return (
    (usage.input * price.input + usage.output * price.output + usage.cached * price.cacheRead) / 1_000_000
  );
}
