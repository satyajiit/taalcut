// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Provider wire formats for the mock server: the SSE streams OpenAI
 * (Responses and Chat Completions), Anthropic (Messages) and Google
 * (Gemini streamGenerateContent) send, so pi-ai's real parsing code runs in
 * tests.
 */

export interface MockUsage {
  /** Prompt tokens not served from cache. */
  readonly input: number;
  readonly output: number;
  readonly cached?: number;
  readonly reasoning?: number;
}

export interface MockReply {
  readonly text?: string;
  readonly reasoning?: string;
  readonly toolCall?: { readonly name: string; readonly args: Record<string, unknown> };
  readonly usage?: MockUsage;
}

export const DEFAULT_USAGE: MockUsage = { input: 1000, output: 300, cached: 200 };

const sse = (event: string | undefined, data: unknown): string =>
  `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;

/** Splits text into a few deltas so streaming is visible. */
export function chunks(text: string): string[] {
  const words = text.split(/(?<= )/);
  return words.length > 0 ? words : [text];
}

export function openAIResponses(model: string, reply: MockReply): string[] {
  const usage = reply.usage ?? DEFAULT_USAGE;
  const events: string[] = [];
  let seq = 0;
  const push = (type: string, body: Record<string, unknown>) =>
    events.push(sse(type, { type, sequence_number: seq++, ...body }));
  const base = {
    id: 'resp_mock_1',
    object: 'response',
    created_at: 1_760_000_000,
    model,
    output: [] as unknown[],
  };
  push('response.created', { response: { ...base, status: 'in_progress' } });
  const output: unknown[] = [];
  let index = 0;
  if (reply.reasoning) {
    const item = { id: 'rs_mock_1', type: 'reasoning', summary: [] as unknown[] };
    push('response.output_item.added', { output_index: index, item });
    for (const delta of chunks(reply.reasoning)) {
      push('response.reasoning_summary_text.delta', {
        item_id: item.id,
        output_index: index,
        summary_index: 0,
        delta,
      });
    }
    const done = {
      ...item,
      summary: [{ type: 'summary_text', text: reply.reasoning }],
      encrypted_content: 'enc_mock',
    };
    push('response.output_item.done', { output_index: index, item: done });
    output.push(done);
    index += 1;
  }
  if (reply.text) {
    const item = { id: 'msg_mock_1', type: 'message', status: 'in_progress', role: 'assistant', content: [] };
    push('response.output_item.added', { output_index: index, item });
    for (const delta of chunks(reply.text)) {
      push('response.output_text.delta', { item_id: item.id, output_index: index, content_index: 0, delta });
    }
    const content = [{ type: 'output_text', text: reply.text, annotations: [] }];
    const done = { ...item, status: 'completed', content };
    push('response.output_item.done', { output_index: index, item: done });
    output.push(done);
    index += 1;
  }
  if (reply.toolCall) {
    const args = JSON.stringify(reply.toolCall.args);
    const item = {
      id: 'fc_mock_1',
      type: 'function_call',
      status: 'in_progress',
      arguments: '',
      call_id: 'call_mock_1',
      name: reply.toolCall.name,
    };
    push('response.output_item.added', { output_index: index, item });
    push('response.function_call_arguments.delta', { item_id: item.id, output_index: index, delta: args });
    push('response.function_call_arguments.done', { item_id: item.id, output_index: index, arguments: args });
    const done = { ...item, status: 'completed', arguments: args };
    push('response.output_item.done', { output_index: index, item: done });
    output.push(done);
  }
  const cached = usage.cached ?? 0;
  push('response.completed', {
    response: {
      ...base,
      status: 'completed',
      output,
      usage: {
        input_tokens: usage.input + cached,
        input_tokens_details: { cached_tokens: cached },
        output_tokens: usage.output,
        output_tokens_details: { reasoning_tokens: usage.reasoning ?? 0 },
        total_tokens: usage.input + cached + usage.output,
      },
    },
  });
  return events;
}

export function anthropicMessages(model: string, reply: MockReply): string[] {
  const usage = reply.usage ?? DEFAULT_USAGE;
  const events: string[] = [];
  const push = (type: string, body: Record<string, unknown>) => events.push(sse(type, { type, ...body }));
  push('message_start', {
    message: {
      id: 'msg_mock_1',
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: usage.input,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: usage.cached ?? 0,
        output_tokens: 1,
      },
    },
  });
  let index = 0;
  if (reply.reasoning) {
    push('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
    for (const thinking of chunks(reply.reasoning))
      push('content_block_delta', { index, delta: { type: 'thinking_delta', thinking } });
    push('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig_mock' } });
    push('content_block_stop', { index });
    index += 1;
  }
  if (reply.text) {
    push('content_block_start', { index, content_block: { type: 'text', text: '' } });
    for (const text of chunks(reply.text))
      push('content_block_delta', { index, delta: { type: 'text_delta', text } });
    push('content_block_stop', { index });
    index += 1;
  }
  if (reply.toolCall) {
    push('content_block_start', {
      index,
      content_block: { type: 'tool_use', id: 'toolu_mock_1', name: reply.toolCall.name, input: {} },
    });
    push('content_block_delta', {
      index,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(reply.toolCall.args) },
    });
    push('content_block_stop', { index });
  }
  push('message_delta', {
    delta: { stop_reason: reply.toolCall ? 'tool_use' : 'end_turn', stop_sequence: null },
    usage: { output_tokens: usage.output },
  });
  push('message_stop', {});
  return events;
}

export function chatCompletions(model: string, reply: MockReply): string[] {
  const usage = reply.usage ?? DEFAULT_USAGE;
  const frame = (delta: Record<string, unknown>, finish: string | null = null) =>
    sse(undefined, {
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      created: 1_760_000_000,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
  const events: string[] = [frame({ role: 'assistant', content: '' })];
  if (reply.reasoning) for (const r of chunks(reply.reasoning)) events.push(frame({ reasoning: r }));
  if (reply.text) for (const c of chunks(reply.text)) events.push(frame({ content: c }));
  if (reply.toolCall) {
    const call = {
      index: 0,
      id: 'call_mock_1',
      type: 'function',
      function: { name: reply.toolCall.name, arguments: '' },
    };
    events.push(frame({ tool_calls: [call] }));
    events.push(
      frame({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(reply.toolCall.args) } }] }),
    );
  }
  events.push(frame({}, reply.toolCall ? 'tool_calls' : 'stop'));
  const cached = usage.cached ?? 0;
  events.push(
    sse(undefined, {
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      created: 1_760_000_000,
      model,
      choices: [],
      usage: {
        prompt_tokens: usage.input + cached,
        completion_tokens: usage.output,
        total_tokens: usage.input + cached + usage.output,
        prompt_tokens_details: { cached_tokens: cached },
      },
    }),
  );
  events.push('data: [DONE]\n\n');
  return events;
}

/**
 * Gemini's streamGenerateContent with alt=sse: one GenerateContentResponse per
 * event, thoughts as parts with `thought: true`, the finish reason and the
 * usage totals on the last one.
 */
export function geminiStream(model: string, reply: MockReply): string[] {
  const usage = reply.usage ?? DEFAULT_USAGE;
  const cached = usage.cached ?? 0;
  const thoughts = usage.reasoning ?? 0;
  const response = (parts: unknown[], last = false) =>
    sse(undefined, {
      candidates: [
        {
          content: { role: 'model', parts },
          index: 0,
          ...(last ? { finishReason: 'STOP' } : {}),
        },
      ],
      ...(last
        ? {
            usageMetadata: {
              promptTokenCount: usage.input + cached,
              candidatesTokenCount: usage.output,
              ...(cached ? { cachedContentTokenCount: cached } : {}),
              ...(thoughts ? { thoughtsTokenCount: thoughts } : {}),
              totalTokenCount: usage.input + cached + usage.output + thoughts,
            },
          }
        : {}),
      modelVersion: model,
      responseId: 'mock-gemini-response',
    });
  const parts: unknown[][] = [];
  if (reply.reasoning) parts.push([{ text: reply.reasoning, thought: true }]);
  if (reply.text) for (const c of chunks(reply.text)) parts.push([{ text: c }]);
  if (reply.toolCall)
    parts.push([{ functionCall: { name: reply.toolCall.name, args: reply.toolCall.args } }]);
  return parts.map((p, i) => response(p, i === parts.length - 1));
}

/** Error bodies in each provider's shape. */
export function errorBody(
  route: 'openai' | 'anthropic' | 'chat' | 'gemini',
  status: number,
  message: string,
): unknown {
  if (route === 'gemini') {
    const statusName =
      status === 429
        ? 'RESOURCE_EXHAUSTED'
        : status === 401
          ? 'UNAUTHENTICATED'
          : status >= 500
            ? 'UNAVAILABLE'
            : 'INVALID_ARGUMENT';
    return { error: { code: status, message, status: statusName } };
  }
  if (route === 'anthropic') {
    const type =
      status === 429
        ? 'rate_limit_error'
        : status === 401
          ? 'authentication_error'
          : status >= 500
            ? 'overloaded_error'
            : 'invalid_request_error';
    return { type: 'error', error: { type, message } };
  }
  const code = status === 429 ? 'rate_limit_exceeded' : status === 401 ? 'invalid_api_key' : null;
  return {
    error: { message, type: status >= 500 ? 'server_error' : 'invalid_request_error', param: null, code },
  };
}
