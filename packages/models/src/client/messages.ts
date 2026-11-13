// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Taalcut's own conversation types. Other packages persist these (the agent's
 * event log), so they must not change when pi-ai does. Assistant messages keep
 * pi-ai's message as an opaque `native` value: it carries provider signatures
 * (encrypted reasoning, thought signatures) that multi-turn calls need, and pi-ai
 * itself converts it when the next call goes to a different provider.
 */
import type {
  AssistantMessage as PiAssistantMessage,
  Context as PiContext,
  ImageContent as PiImage,
  Message as PiMessage,
  TextContent as PiText,
  ToolCall as PiToolCall,
} from '@earendil-works/pi-ai';
import { z } from 'zod';

const TextPartSchema = z.object({ type: z.literal('text'), text: z.string() });
const ImagePartSchema = z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() });
export const ContentPartSchema = z.discriminatedUnion('type', [TextPartSchema, ImagePartSchema]);
export type ContentPart = z.infer<typeof ContentPartSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

const AssistantPartSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  z.object({ type: z.literal('reasoning'), text: z.string() }),
  z.object({ type: z.literal('tool_call'), call: ToolCallSchema }),
]);
export type AssistantPart = z.infer<typeof AssistantPartSchema>;

export const ChatMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.union([z.string(), z.array(ContentPartSchema)]) }),
  z.object({
    role: z.literal('assistant'),
    parts: z.array(AssistantPartSchema),
    provider: z.string(),
    model: z.string(),
    /** pi-ai's message, passed back unchanged. Treat as opaque. */
    native: z.unknown().optional(),
  }),
  z.object({
    role: z.literal('tool'),
    toolCallId: z.string(),
    toolName: z.string(),
    content: z.union([z.string(), z.array(ContentPartSchema)]),
    isError: z.boolean().optional(),
  }),
]);
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type AssistantChatMessage = Extract<ChatMessage, { role: 'assistant' }>;

/** Builds the assistant message Taalcut stores from pi-ai's final message. */
export function fromPiAssistant(message: PiAssistantMessage): AssistantChatMessage {
  const parts: AssistantPart[] = [];
  for (const block of message.content) {
    if (block.type === 'text') parts.push({ type: 'text', text: block.text });
    else if (block.type === 'thinking') parts.push({ type: 'reasoning', text: block.thinking });
    else parts.push({ type: 'tool_call', call: fromPiToolCall(block) });
  }
  return { role: 'assistant', parts, provider: message.provider, model: message.model, native: message };
}

export function fromPiToolCall(call: PiToolCall): ToolCall {
  return { id: call.id, name: call.name, arguments: { ...call.arguments } };
}

/** The pi-ai context for one request. `now` stamps messages that have no time of their own. */
export function toPiContext(
  system: string | undefined,
  messages: readonly ChatMessage[],
  now: number,
): PiContext {
  return {
    ...(system ? { systemPrompt: system } : {}),
    messages: messages.map((message) => toPiMessage(message, now)),
  };
}

function toPiMessage(message: ChatMessage, now: number): PiMessage {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: toPiContent(message.content), timestamp: now };
    case 'tool':
      return {
        role: 'toolResult',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: toPiParts(message.content),
        isError: message.isError ?? false,
        timestamp: now,
      };
    case 'assistant':
      return isPiAssistant(message.native) ? message.native : rebuildAssistant(message, now);
  }
}

function toPiContent(content: string | ContentPart[]): string | (PiText | PiImage)[] {
  return typeof content === 'string' ? content : toPiParts(content);
}

function toPiParts(content: string | ContentPart[]): (PiText | PiImage)[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image', data: part.data, mimeType: part.mimeType },
  );
}

/** For assistant messages written by hand (tests, imported history) that have no native form. */
function rebuildAssistant(message: AssistantChatMessage, now: number): PiAssistantMessage {
  return {
    role: 'assistant',
    api: 'unknown',
    provider: message.provider,
    model: message.model,
    content: message.parts.map((part) => {
      if (part.type === 'text') return { type: 'text', text: part.text };
      if (part.type === 'reasoning') return { type: 'thinking', thinking: part.text };
      return {
        type: 'toolCall',
        id: part.call.id,
        name: part.call.name,
        arguments: toJsonObject(part.call.arguments),
      };
    }),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zeroCost() },
    stopReason: message.parts.some((p) => p.type === 'tool_call') ? 'toolUse' : 'stop',
    timestamp: now,
  };
}

function isPiAssistant(value: unknown): value is PiAssistantMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.role === 'assistant' && Array.isArray(v.content) && typeof v.provider === 'string';
}

function toJsonObject(value: Record<string, unknown>): PiToolCall['arguments'] {
  return JSON.parse(JSON.stringify(value)) as PiToolCall['arguments'];
}

export function zeroCost(): PiAssistantMessage['usage']['cost'] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}
