// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Agent-shaped scenarios shared by the live Ollama test (which records) and
 * the offline replay suite (which replays). They must send byte-identical
 * requests in both, so everything that shapes a request lives here.
 */
import { join } from 'node:path';
import { z } from 'zod';
import {
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  OLLAMA_DEFAULT_BASE_URL,
  parseToolCall,
  type ChatMessage,
  type FetchFn,
  type LocalEndpoint,
  type ModelChoice,
  type ModelClient,
  type ModelResult,
  type ToolSpec,
} from '@taalcut/models';

export const CASSETTE_DIR = join(import.meta.dirname, '..', 'fixtures', 'cassettes');
export const OLLAMA_MODEL = 'qwen3:0.6b';
export const OLLAMA: ModelChoice = { provider: 'ollama', model: OLLAMA_MODEL };

export const OLLAMA_ENDPOINT: LocalEndpoint = {
  id: 'ollama',
  name: 'Ollama',
  baseUrl: OLLAMA_DEFAULT_BASE_URL,
  models: [
    { id: OLLAMA_MODEL, name: 'Qwen3 0.6B', reasoning: true, contextWindow: 40_960, maxTokens: 1_024 },
  ],
};

export function ollamaClient(fetch?: FetchFn) {
  const runtime = createModelRuntime({ endpoints: [OLLAMA_ENDPOINT], builtinProviders: [] });
  const callLog = createMemoryCloudCallSink();
  const client = createModelClient({
    runtime,
    credentials: createStaticCredentialProvider({}),
    callLog,
    retry: { maxRetries: 0, timeoutMs: 120_000 },
    ...(fetch ? { fetch } : {}),
  });
  return { runtime, callLog, client };
}

export const HOOK_QUESTION: ChatMessage[] = [
  { role: 'user', content: 'In one short sentence: what makes a good hook for a short video?' },
];

export const findClips: ToolSpec = {
  name: 'find_clips',
  description: 'Search the video library for clips that match a description.',
  parameters: z.object({ query: z.string().describe('What the clips should show') }),
};

const EDITOR_SYSTEM = 'You are a video editing assistant. When the user asks for clips, call find_clips.';

/** Asks once, with no reasoning. */
export function askHook(client: ModelClient, target: ModelChoice) {
  return client.complete({
    module: 'agent',
    target,
    system: 'Answer briefly.',
    messages: HOOK_QUESTION,
    temperature: 0,
  });
}

/** Asks with reasoning on, so the model thinks before answering. */
export function askHookThinking(client: ModelClient, target: ModelChoice) {
  return client.complete({
    module: 'agent',
    target,
    system: 'Answer briefly.',
    messages: HOOK_QUESTION,
    reasoning: 'low',
    temperature: 0,
  });
}

export interface ToolLoopOutcome {
  readonly first: ModelResult;
  readonly query: string;
  readonly final: ModelResult;
}

/** The agent loop in miniature: the model calls a tool, gets the result, and answers. */
export async function runToolLoop(client: ModelClient, target: ModelChoice): Promise<ToolLoopOutcome> {
  const messages: ChatMessage[] = [{ role: 'user', content: 'Find clips of the beach at sunset.' }];
  const first = await client.complete({
    module: 'agent',
    target,
    system: EDITOR_SYSTEM,
    messages,
    tools: [findClips],
    temperature: 0,
  });
  if (!first.ok) throw new Error(`first turn failed: ${first.error.code} ${first.error.detail ?? ''}`);
  const call = first.value.toolCalls[0];
  if (!call) throw new Error(`no tool call; the model said: ${first.value.text}`);
  const args = parseToolCall(findClips, call);
  if (!args.ok) throw new Error(`bad tool arguments: ${args.error.detail ?? ''}`);
  const query = (args.value as { query: string }).query;

  messages.push(first.value.message, {
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content: 'Found 3 clips: beach_sunset_01.mov (12 s), beach_sunset_02.mov (8 s), pier_dusk.mov (15 s).',
  });
  const final = await client.complete({
    module: 'agent',
    target,
    system: EDITOR_SYSTEM,
    messages,
    tools: [findClips],
    temperature: 0,
  });
  if (!final.ok) throw new Error(`second turn failed: ${final.error.code} ${final.error.detail ?? ''}`);
  return { first: first.value, query, final: final.value };
}

export async function ollamaReachable(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return false;
    const { models } = (await response.json()) as { models?: { name: string }[] };
    return (models ?? []).some((m) => m.name === OLLAMA_MODEL);
  } catch {
    return false;
  }
}

/** A made-up Gemini key in Google's shape, so the scrubber's pattern applies too. */
export const GEMINI_KEY = 'AIzaSyTaalcutTestKeyNotReal0123456789ab';
export const GEMINI: ModelChoice = { provider: 'google', model: 'gemini-3.5-flash', reasoning: 'low' };

/** A 1x1 red PNG: the smallest frame a vision call can carry. */
const RED_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

/** ModelClient for Google with the test key; `baseUrl` points it at the mock server instead of Google. */
export function geminiClient(fetch: FetchFn, baseUrl?: string) {
  const runtime = createModelRuntime({
    builtinProviders: ['google'],
    ...(baseUrl ? { baseUrlOverrides: { google: baseUrl } } : {}),
  });
  const callLog = createMemoryCloudCallSink();
  const client = createModelClient({
    runtime,
    credentials: createStaticCredentialProvider({
      google: { kind: 'api_key', secret: GEMINI_KEY, source: 'test' },
    }),
    callLog,
    fetch,
    retry: { maxRetries: 0 },
  });
  return { client, callLog };
}

export function askGeminiText(client: ModelClient) {
  return client.complete({
    module: 'agent',
    target: GEMINI,
    system: 'Answer briefly.',
    messages: [{ role: 'user', content: 'Where should a cut land in a 120 BPM track?' }],
    temperature: 0,
  });
}

export function askGeminiVision(client: ModelClient) {
  return client.complete({
    module: 'vision',
    target: GEMINI,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this frame in one sentence.' },
          { type: 'image', data: RED_PIXEL_PNG, mimeType: 'image/png' },
        ],
      },
    ],
    temperature: 0,
  });
}
