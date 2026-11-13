// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One agent run against a real model through @taalcut/models, shared by the
 * recording test (live Ollama qwen3:0.6b, TAALCUT_RECORD=1) and the offline
 * replay test. Both must send byte-identical requests, so everything that
 * shapes them lives here.
 */
import { join } from 'node:path';
import { ok, type ToolModule } from '@taalcut/core';
import {
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  OLLAMA_DEFAULT_BASE_URL,
  type FetchFn,
  type ModelChoice,
} from '@taalcut/models';
import { clipsModule } from './fixtures';

export const CASSETTE = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'cassettes',
  'agent-ollama-count-words.json',
);
export const OLLAMA: ModelChoice = { provider: 'ollama', model: 'qwen3:0.6b' };
export const REQUEST = {
  conversationId: 'live',
  message:
    'First call updatePlan with one step: "Count the words". Then call clips_countWords with text "hook in the first second". Then tell me the number.',
};
export const MODULES: ToolModule[] = [clipsModule()];
/** Deterministic sampling and short answers, so the recording is small and stable. */
export const LOOP = { temperature: 0, reasoning: 'low' as const, maxOutputTokens: 1024 };

/** An Ollama model as the runtime describes it. */
export interface OllamaModel {
  readonly id: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

/** A model client that sends every module to one Ollama model through @taalcut/models (no retries). */
export function ollamaClient(
  fetch: FetchFn,
  model: OllamaModel,
  options: { readonly baseUrl?: string; readonly timeoutMs: number },
) {
  const runtime = createModelRuntime({
    builtinProviders: [],
    endpoints: [
      {
        id: 'ollama',
        name: 'Ollama',
        baseUrl: options.baseUrl ?? OLLAMA_DEFAULT_BASE_URL,
        models: [
          { id: model.id, reasoning: true, contextWindow: model.contextWindow, maxTokens: model.maxTokens },
        ],
      },
    ],
  });
  const callLog = createMemoryCloudCallSink();
  const choice: ModelChoice = { provider: 'ollama', model: model.id };
  const client = createModelClient({
    runtime,
    credentials: createStaticCredentialProvider({}),
    callLog,
    selector: { resolve: (module) => ok({ module, choices: [choice] }) },
    retry: { maxRetries: 0, timeoutMs: options.timeoutMs },
    fetch,
  });
  return { client, callLog };
}

export function ollamaModels(fetch: FetchFn) {
  return ollamaClient(
    fetch,
    { id: OLLAMA.model, contextWindow: 40_960, maxTokens: 1_024 },
    { timeoutMs: 120_000 },
  );
}

export async function ollamaReachable(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1_500) });
    const { models } = (await response.json()) as { models?: { name: string }[] };
    return (models ?? []).some((m) => m.name === OLLAMA.model);
  } catch {
    return false;
  }
}
