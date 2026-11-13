// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Model clients that need no network: a scripted one for tests and the
 * end-to-end smoke test (P1-I1), and the stream builder replay uses. Scripts
 * decide from the request (not from a call counter), so a run resumed in a
 * new process gets the same answers.
 */
import { err, newId, ok, type CloudCallRecord, type Result, type TaalcutError } from '@taalcut/core';
import type {
  CallUsage,
  ChatMessage,
  ModelClient,
  ModelEvent,
  ModelRequest,
  ModelResult,
  ModelStream,
  ToolCall,
} from '@taalcut/models';
import { CONTROL_PREFIX } from './prompt';

export interface ScriptedReply {
  readonly text?: string;
  /** The model's reasoning, streamed before its text and kept in the message. */
  readonly reasoning?: string;
  readonly toolCalls?: readonly {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
    readonly id?: string;
  }[];
  readonly usage?: Partial<CallUsage>;
  readonly provider?: string;
  readonly model?: string;
  /** FIX-RUN: a plan the person signed in with pays for the call (a ChatGPT subscription). */
  readonly planBilled?: boolean;
  readonly error?: TaalcutError;
}

/**
 * `turn` is the number of assistant messages since the run's own message (the
 * last user message that isn't the agent's): 0 for the first call of a run,
 * also when the conversation's earlier turns come first.
 */
export type ModelScript = (request: ModelRequest, turn: number) => ScriptedReply;

/** Where the run's own part of a request starts: its user message (earlier turns come before it). */
export function runMessageIndex(messages: readonly ChatMessage[]): number {
  return messages.findLastIndex(
    (m) => m.role === 'user' && !(typeof m.content === 'string' && m.content.startsWith(CONTROL_PREFIX)),
  );
}

/** The user message that started the run: the run's own, not the earlier turns'. */
export function runMessage(request: Pick<ModelRequest, 'messages'>): string {
  const message = request.messages[runMessageIndex(request.messages)];
  if (message?.role !== 'user') return '';
  return typeof message.content === 'string'
    ? message.content
    : message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

export interface ScriptedClientOptions {
  /** Gets one CloudCall record per call, as the real ModelClient's call log does (G9). */
  readonly callLog?: { record(record: CloudCallRecord): unknown };
  readonly now?: () => number;
}

export function createScriptedModelClient(
  script: ModelScript,
  options: ScriptedClientOptions = {},
): ModelClient & { readonly requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const now = options.now ?? Date.now;
  const client = {
    requests,
    stream(request: ModelRequest): ModelStream {
      requests.push(request);
      const startedAt = now();
      const turn = request.messages
        .slice(Math.max(0, runMessageIndex(request.messages)))
        .filter((m) => m.role === 'assistant').length;
      const reply = script(request, turn);
      const outcome = reply.error ? err(reply.error) : ok(scriptedResult(request, reply, turn));
      void options.callLog?.record(callRecord(request, reply, outcome, startedAt));
      return streamOf(outcome);
    },
    complete(request: ModelRequest) {
      return client.stream(request).result();
    },
  };
  return client;
}

export function scriptedResult(request: ModelRequest, reply: ScriptedReply, turn = 0): ModelResult {
  const provider = reply.provider ?? 'scripted';
  const model = reply.model ?? 'script-1';
  const toolCalls: ToolCall[] = (reply.toolCalls ?? []).map((c, i) => ({
    id: c.id ?? `call_${turn}_${i}`,
    name: c.name,
    arguments: c.arguments,
  }));
  const text = reply.text ?? '';
  const usage: CallUsage = {
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    ...reply.usage,
    totalTokens: (reply.usage?.inputTokens ?? 100) + (reply.usage?.outputTokens ?? 20),
  };
  const message: Extract<ChatMessage, { role: 'assistant' }> = {
    role: 'assistant',
    provider,
    model,
    parts: [
      ...(reply.reasoning ? [{ type: 'reasoning' as const, text: reply.reasoning }] : []),
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...toolCalls.map((call) => ({ type: 'tool_call' as const, call })),
    ],
  };
  return {
    callId: newId<'CloudCall'>(),
    module: request.module,
    provider,
    model,
    reasoning: 'off',
    message,
    text,
    toolCalls,
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
    usage,
    latencyMs: 5,
    local: provider === 'scripted',
    ...(reply.planBilled ? { planBilled: true } : {}),
  };
}

function callRecord(
  request: ModelRequest,
  reply: ScriptedReply,
  outcome: Result<ModelResult>,
  startedAt: number,
): CloudCallRecord {
  const result = outcome.ok ? outcome.value : undefined;
  const provider = result?.provider ?? reply.provider ?? 'scripted';
  return {
    id: result?.callId ?? newId<'CloudCall'>(),
    module: request.module,
    provider,
    model: result?.model ?? reply.model ?? 'script-1',
    reasoning: 'off',
    local: provider === 'scripted',
    startedAt,
    latencyMs: result?.latencyMs ?? 0,
    bytesSent: new TextEncoder().encode(JSON.stringify(request.messages)).byteLength,
    bytesReceived: new TextEncoder().encode(result?.text ?? '').byteLength,
    inputTokens: result?.usage.inputTokens ?? 0,
    outputTokens: result?.usage.outputTokens ?? 0,
    cachedInputTokens: result?.usage.cachedInputTokens ?? 0,
    cacheWriteTokens: result?.usage.cacheWriteTokens ?? 0,
    costUsd: result?.usage.costUsd ?? 0,
    outcome: outcome.ok ? 'ok' : 'error',
    ...(outcome.ok ? {} : { errorCode: outcome.error.code }),
    attempt: 1,
    ...(request.trace?.runId ? { runId: request.trace.runId } : {}),
    ...(request.trace?.spanId ? { spanId: request.trace.spanId } : {}),
    ...(request.trace?.projectId ? { projectId: request.trace.projectId } : {}),
  };
}

/** A ModelStream that replays a finished outcome as events: start, reasoning, text, tool calls, usage, done (or error). */
export function streamOf(outcome: Result<ModelResult>): ModelStream {
  const events: ModelEvent[] = [];
  if (outcome.ok) {
    const r = outcome.value;
    events.push({
      type: 'start',
      callId: r.callId,
      module: r.module,
      provider: r.provider,
      model: r.model,
      reasoning: r.reasoning,
      local: r.local,
    });
    for (const part of r.message.parts)
      if (part.type === 'reasoning') events.push({ type: 'reasoning_delta', index: 0, delta: part.text });
    if (r.text) events.push({ type: 'text_delta', index: 0, delta: r.text });
    r.toolCalls.forEach((call, index) => events.push({ type: 'tool_call', index, call }));
    events.push({ type: 'usage', callId: r.callId, usage: r.usage }, { type: 'done', result: r });
  } else {
    events.push({ type: 'error', error: outcome.error });
  }
  return {
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
    result: async () => outcome,
  };
}
