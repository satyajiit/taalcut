// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Designer loop's model on a @taalcut/models client (HFW1 dsn): the ChatGPT plan (plan/chatgpt.ts), turn by turn
 * as the app's Designer runs on the chat's model (apps/desktop agent-designer.ts `chatDesigner`, whose message
 * mapping this copies): module `agent`, the loop's messages as the client's, a render's stills in its tool message as
 * pictures when the model sees images, and the model's own message passed back for the next turn. Each call keeps
 * the eval's cloud limits (CLOUD_CALL_LIMITS: a cap on the answer, which the plan's rules may drop, and a deadline),
 * and anything it says back goes through `scrub` first.
 */
import { err, newId, ok, TimeoutError, type TaalcutError } from '@taalcut/core';
import type { AssistantChatMessage, ChatMessage, ModelClient } from '@taalcut/models';
import type { DesignerMessage, DesignerModel } from '@taalcut/render';
import { CLOUD_CALL_LIMITS } from './openai-designer';

const isAssistant = (value: unknown): value is AssistantChatMessage =>
  typeof value === 'object' && value !== null && (value as { role?: unknown }).role === 'assistant';

/** The loop's messages as the model client takes them (as the app's chatDesigner maps them). */
export function chatMessages(messages: readonly DesignerMessage[]): ChatMessage[] {
  return messages.map((message): ChatMessage => {
    if (message.role === 'user') return { role: 'user', content: [...message.content] };
    if (message.role === 'tool')
      return {
        role: 'tool',
        toolCallId: message.callId,
        toolName: message.name,
        content: [...message.content],
        isError: message.isError,
      };
    if (isAssistant(message.native)) return message.native;
    const [provider = '', ...rest] = (message.model ?? '').split('/');
    return {
      role: 'assistant',
      parts: [
        ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
        ...message.calls.map((call) => ({ type: 'tool_call' as const, call: { ...call, arguments: { ...call.arguments } } })),
      ],
      provider,
      model: rest.join('/'),
    };
  });
}

export interface ClientDesignerOptions {
  readonly client: ModelClient;
  readonly seesImages: boolean;
  /** Removes tokens from what the eval keeps (an error's detail). */
  readonly scrub: (text: string) => string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  /** The request a failure came from (plan/chatgpt.ts `lastRequest`), added to its detail. */
  readonly lastRequest?: () => string | undefined;
  /** Told each failed call, its line scrubbed: the code, the provider's words, the request. */
  readonly onFailure?: (line: string) => void;
}

/** The error with the request it came from in its detail, every token scrubbed out. */
function failure(error: TaalcutError, options: ClientDesignerOptions): TaalcutError {
  const request = options.lastRequest?.();
  const detail = [error.detail, request ? `request: ${request}` : undefined].filter(Boolean).join(' | ');
  const out = detail ? { ...error, detail: options.scrub(detail) } : error;
  options.onFailure?.(options.scrub(`model call failed: ${out.code}${out.detail ? `: ${out.detail}` : ''}`));
  return out;
}

export function clientDesigner(options: ClientDesignerOptions): DesignerModel {
  const timeoutMs = options.timeoutMs ?? CLOUD_CALL_LIMITS.timeoutMs;
  return {
    seesImages: options.seesImages,
    async turn(request, signal) {
      const deadline = AbortSignal.timeout(timeoutMs);
      const answer = await options.client.complete({
        module: 'agent',
        system: request.system,
        messages: chatMessages(request.messages),
        tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.schema })),
        maxTokens: Math.min(request.maxTokens, options.maxTokens ?? CLOUD_CALL_LIMITS.maxTokens),
        trace: { spanId: newId<'Span'>() },
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      if (!answer.ok) return err(failure(deadline.aborted ? TimeoutError({ ms: timeoutMs }) : answer.error, options));
      const { text, toolCalls, provider, model, local, message } = answer.value;
      return ok({ text, calls: toolCalls, model: `${provider}/${model}`, local, native: message });
    },
  };
}
