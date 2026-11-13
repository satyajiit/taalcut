// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Designer loop's model behind an OpenAI-compatible Chat Completions endpoint (HFW1 dsn): a cloud model with
 * `--base-url --api-key --model`, or the 9B through Taalcut's MLX server (thinking off, as the graphics eval runs
 * it). Tool messages can't hold pictures there, so a render's stills follow its tool message as a user message, for
 * a model that sees. A call whose arguments aren't JSON goes to the loop with none (the tool refuses it) and is
 * counted as malformed.
 */
import { err, ok, TimeoutError, UnknownError } from '@taalcut/core';
import type { DesignerMessage, DesignerModel, DesignerPart } from '@taalcut/render';

type OpenAiContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
interface OpenAiMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: OpenAiContent | null;
  readonly tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  readonly tool_call_id?: string;
}

const partsOf = (parts: readonly DesignerPart[]): OpenAiContent =>
  parts.map((part) =>
    part.type === 'text'
      ? { type: 'text' as const, text: part.text }
      : { type: 'image_url' as const, image_url: { url: `data:${part.mimeType};base64,${part.data}` } },
  );

function openAiMessages(system: string, messages: readonly DesignerMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'user') out.push({ role: 'user', content: partsOf(message.content) });
    else if (message.role === 'assistant')
      out.push({
        role: 'assistant',
        content: message.text || null,
        ...(message.calls.length
          ? {
              tool_calls: message.calls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
    else {
      const words = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
      out.push({ role: 'tool', tool_call_id: message.callId, content: words });
      const images = message.content.filter((part) => part.type === 'image');
      if (images.length > 0)
        out.push({ role: 'user', content: partsOf([{ type: 'text', text: `The stills from ${message.name}:` }, ...images]) });
    }
  }
  return out;
}

export interface OpenAiDesignerOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly seesImages: boolean;
  /** The MLX server's chat template takes it; a cloud endpoint may not. */
  readonly thinkingOff?: boolean;
  /** Counts calls whose arguments weren't JSON. */
  readonly onMalformed?: () => void;
  /** The most tokens one answer may have (a runaway answer stops there). */
  readonly maxTokens?: number;
  /** One call's wall-clock limit: a call past it fails, and so does its case, instead of hanging the run. */
  readonly timeoutMs?: number;
}

/** A local answer can run on without end (FIX-CMT): each call has its own cap and deadline. */
export const LOCAL_CALL_LIMITS = { maxTokens: 6_144, timeoutMs: 300_000 } as const;
export const CLOUD_CALL_LIMITS = { maxTokens: 8_000, timeoutMs: 180_000 } as const;

export function openAiDesigner(options: OpenAiDesignerOptions): DesignerModel {
  return {
    seesImages: options.seesImages,
    async turn(request, signal) {
      const deadline = AbortSignal.timeout(options.timeoutMs ?? CLOUD_CALL_LIMITS.timeoutMs);
      const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({
          model: options.model,
          messages: openAiMessages(request.system, request.messages),
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
          tool_choice: 'auto',
          temperature: 0,
          max_tokens: Math.min(request.maxTokens, options.maxTokens ?? CLOUD_CALL_LIMITS.maxTokens),
          stream: false,
          ...(options.thinkingOff ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        }),
        signal: stop,
      }).catch((cause: unknown) => cause as Error);
      if (response instanceof Error)
        return err(
          deadline.aborted
            ? TimeoutError({ ms: options.timeoutMs ?? CLOUD_CALL_LIMITS.timeoutMs })
            : UnknownError(undefined, { detail: String(response).slice(0, 300) }),
        );
      if (!response.ok)
        return err(UnknownError(undefined, { detail: `${response.status}: ${(await response.text()).slice(0, 300)}` }));
      const body = (await response.json().catch(() => ({}))) as { choices?: { message?: OpenAiMessage }[] };
      const message = body.choices?.[0]?.message;
      const calls = (message?.tool_calls ?? []).map((call) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          options.onMalformed?.();
        }
        return { id: call.id, name: call.function.name, arguments: args };
      });
      const text = typeof message?.content === 'string' ? message.content : '';
      return ok({ text, calls, model: `openai-compatible/${options.model}`, local: false });
    },
  };
}
