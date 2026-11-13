// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test doubles for vision tools: a ToolContext, a job runner for frames, a model
 * selector and a scripted ModelClient. No network, no FFmpeg.
 */
import {
  err,
  newId,
  NotFoundError,
  ok,
  type ArtifactStore,
  type Result,
  type StoredArtifact,
  type TaalcutError,
  type ToolContextBase,
  type ToolUsage,
} from '@taalcut/core';
import {
  MEDIA_JOB_STAGES,
  mediaExtractFrameJob,
  type ExtractFrameJobInput,
  type ExtractFrameJobOutput,
  type JobRunner,
  type JobRunOptions,
} from '@taalcut/media';
import {
  createModelRuntime,
  type ModelChoice,
  type ModelClient,
  type ModelEvent,
  type ModelRequest,
  type ModelResult,
  type ModelSelector,
  type StopReason,
} from '@taalcut/models';

export interface TestToolContext extends ToolContextBase {
  readonly progress: { fraction: number; note?: string }[];
  readonly usage: ToolUsage[];
}

export function testToolContext(signal = new AbortController().signal): TestToolContext {
  const stored = new Map<string, StoredArtifact>();
  const artifacts: ArtifactStore = {
    put: async (a) => {
      const data = typeof a.data === 'string' ? new TextEncoder().encode(a.data) : a.data;
      const ref = {
        id: newId<'Artifact'>(),
        mediaType: a.mediaType,
        bytes: data.byteLength,
        summary: a.summary,
      };
      stored.set(ref.id, { ref, data });
      return ok(ref);
    },
    get: async (id) => {
      const found = stored.get(id);
      return found ? ok(found) : err(NotFoundError({ entity: 'artifact', id }));
    },
  };
  const progress: TestToolContext['progress'] = [];
  const usage: ToolUsage[] = [];
  return {
    signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts,
    reportUsage: (u) => usage.push(u),
    reportProgress: (fraction, note) => progress.push(note === undefined ? { fraction } : { fraction, note }),
    progress,
    usage,
  };
}

/** A real JPEG header's worth of bytes: what the model client base64-encodes. */
export const FAKE_JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

export interface FakeJobs extends JobRunner {
  readonly calls: { kind: string; input: unknown; options: JobRunOptions }[];
}

/**
 * A JobRunner that answers `media.extractFrame` with `result` (default: a
 * 768x432 JPEG decoded in software), after reporting the job's two stages.
 */
export function fakeJobs(result?: Result<ExtractFrameJobOutput>): FakeJobs {
  const calls: FakeJobs['calls'] = [];
  return {
    calls,
    async run(kind, input, options = {}) {
      calls.push({ kind: kind.kind, input, options });
      if (kind.kind !== mediaExtractFrameJob.kind)
        return err(NotFoundError({ entity: 'job kind', id: kind.kind }));
      options.onProgress?.({ fraction: null, stageKey: MEDIA_JOB_STAGES.extractingFrame });
      options.onProgress?.({ fraction: 1 });
      const frame: ExtractFrameJobOutput = {
        dataBase64: FAKE_JPEG.toString('base64'),
        mimeType: 'image/jpeg',
        width: 768,
        height: 432,
        at: (input as ExtractFrameJobInput).at,
        backend: 'software',
        fallbackReason: { code: 'requested', detail: 'test double' },
      };
      // The real runner validates against kind.output; this double returns what the kind declares.
      return (result ?? ok(frame)) as Result<never>;
    },
  };
}

export const OLLAMA_VL: ModelChoice = { provider: 'ollama', model: 'qwen3-vl:4b', reasoning: 'off' };
export const OLLAMA_VL_SMALL: ModelChoice = { provider: 'ollama', model: 'qwen3-vl:2b', reasoning: 'off' };
export const GEMINI: ModelChoice = { provider: 'google', model: 'gemini-3.5-flash', reasoning: 'low' };
export const GPT_MINI: ModelChoice = { provider: 'openai', model: 'gpt-5.4-mini', reasoning: 'low' };

/** pi-ai's real model metadata (prices), plus a loopback Ollama endpoint that makes 'ollama' local. */
export function testRuntime(ollamaBaseUrl = 'http://127.0.0.1:11434/v1') {
  return createModelRuntime({
    endpoints: [
      {
        id: 'ollama',
        name: 'Ollama',
        baseUrl: ollamaBaseUrl,
        models: [
          { id: 'qwen3-vl:4b', vision: true },
          { id: 'qwen3-vl:2b', vision: true },
        ],
      },
    ],
  });
}

/** A selector whose vision chain the test can change between calls, like a profile switch. */
export function mutableSelector(choices: ModelChoice[]): ModelSelector & { choices: ModelChoice[] } {
  const selector = {
    choices,
    resolve: (module: ModelRequest['module']) => ok({ module, choices: selector.choices }),
  };
  return selector;
}

export function modelResult(
  choice: ModelChoice,
  text: string,
  options: { local?: boolean; costUsd?: number; stopReason?: StopReason } = {},
): ModelResult {
  return {
    callId: newId<'CloudCall'>(),
    module: 'vision',
    provider: choice.provider,
    model: choice.model,
    reasoning: choice.reasoning ?? 'off',
    message: {
      role: 'assistant',
      parts: [{ type: 'text', text }],
      provider: choice.provider,
      model: choice.model,
    },
    text,
    toolCalls: [],
    stopReason: options.stopReason ?? 'stop',
    usage: {
      inputTokens: 700,
      outputTokens: 60,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 760,
      costUsd: options.costUsd ?? 0,
    },
    latencyMs: 5,
    local: options.local ?? false,
  };
}

/** One model attempt in a scripted call: it starts (so it counts as sent), then succeeds or fails. */
export interface ScriptedAttempt {
  readonly choice: ModelChoice;
  readonly local: boolean;
  readonly outcome:
    | { readonly text: string; readonly costUsd?: number; readonly stopReason?: StopReason }
    | { readonly error: TaalcutError };
}

export interface ScriptedClient extends ModelClient {
  readonly requests: ModelRequest[];
}

/** A ModelClient that plays back attempts per request, emitting the events the real one would. */
export function scriptedClient(script: (request: ModelRequest) => ScriptedAttempt[]): ScriptedClient {
  const requests: ModelRequest[] = [];
  const stream: ModelClient['stream'] = (request) => {
    requests.push(request);
    const events: ModelEvent[] = [];
    let outcome: Result<ModelResult> = err(NotFoundError({ entity: 'scripted attempt' }));
    const attempts = script(request);
    for (const [index, attempt] of attempts.entries()) {
      const { choice, local } = attempt;
      events.push({
        type: 'start',
        callId: newId<'CloudCall'>(),
        module: 'vision',
        ...choice,
        reasoning: 'off',
        local,
      });
      if ('error' in attempt.outcome) {
        outcome = err(attempt.outcome.error);
        const next = attempts[index + 1];
        if (next)
          events.push({ type: 'fallback', from: choice, to: next.choice, reason: attempt.outcome.error });
        continue;
      }
      const result = modelResult(choice, attempt.outcome.text, {
        local,
        ...(attempt.outcome.costUsd !== undefined ? { costUsd: attempt.outcome.costUsd } : {}),
        ...(attempt.outcome.stopReason ? { stopReason: attempt.outcome.stopReason } : {}),
      });
      events.push({ type: 'done', result });
      outcome = ok(result);
      break;
    }
    if (!outcome.ok) events.push({ type: 'error', error: outcome.error });
    const final = outcome;
    return {
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
      result: async () => final,
    };
  };
  return { requests, stream, complete: (request) => stream(request).result() };
}
