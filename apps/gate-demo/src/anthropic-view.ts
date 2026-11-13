// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a stand-in model needs to read from an Anthropic Messages request,
 * like a real model would: the run's own part of the conversation (after the
 * earlier turns), the skill whose turn it is, that skill's input note, and
 * the tool calls made since with their results.
 */
import { CONTROL_PREFIX } from '@taalcut/agent';

export interface AnthropicBlock {
  readonly type: string;
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly tool_use_id?: string;
  readonly content?: string | readonly AnthropicBlock[];
}

export interface AnthropicMessage {
  readonly role: string;
  readonly content: string | readonly AnthropicBlock[];
}

export interface AnthropicBody {
  readonly model: string;
  readonly system?: string | readonly AnthropicBlock[];
  readonly messages: readonly AnthropicMessage[];
  readonly tools?: readonly { readonly name: string }[];
}

export const blockText = (content: AnthropicBlock['content']): string =>
  typeof content === 'string' ? content : (content ?? []).map((b) => b.text ?? '').join('');

/** A message's own text: its text blocks, not tool results. */
export const said = (content: AnthropicMessage['content'] | undefined): string =>
  typeof content === 'string'
    ? content
    : (content ?? []).flatMap((b) => (b.type === 'text' ? [b.text ?? ''] : [])).join('');

/**
 * Where the run's own part of a request starts: its user message, the last
 * one with text that isn't the agent's ([Taalcut] notes). The conversation's
 * earlier turns come before it.
 */
export function runStart(messages: readonly AnthropicMessage[]): number {
  return messages.findLastIndex((m) => {
    const words = m.role === 'user' ? said(m.content) : '';
    return words !== '' && !words.startsWith(CONTROL_PREFIX);
  });
}

/** What the run was asked: its own user message's text ('' for none). */
export function runMessageText(messages: readonly AnthropicMessage[]): string {
  return said(messages[runStart(messages)]?.content);
}

/** The turns a saved-progress note stands for (agent SPEC 34: "… saved the work of this step's T earlier turns …"). */
const SAVED_TURNS = /\S+ saved the work of this step's (\d+) earlier turns/g;

/**
 * The model's turns so far in this run: the same request gets the same count after a restart. Turns a
 * progress-saving tool stands for count too, so a request after a save never gets an earlier request's number.
 */
export function runTurn(messages: readonly AnthropicMessage[]): number {
  return messages.slice(Math.max(0, runStart(messages))).reduce((turns, m) => {
    if (m.role === 'assistant') return turns + 1;
    if (m.role !== 'user') return turns;
    return [...said(m.content).matchAll(SAVED_TURNS)].reduce((sum, note) => sum + Number(note[1]), turns);
  }, 0);
}

export interface ToolCall {
  /** The actual model tool-use id, when this view came from a request. */
  readonly id?: string;
  /** Correlation facts explicitly carried in this step’s assistant checkpoint. */
  readonly sourceKey?: string;
  readonly checkpointKey?: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  /** The result as the model sees it ('' until it arrives). */
  readonly result: string;
}

export interface RequestView {
  readonly ask: string;
  /** The skill whose turn this is (`# Skill: <id>` in the system prompt), or null. */
  readonly skill: string | null;
  /** The skill step's input note (`[Taalcut] Skill input: {…}`), or null. */
  readonly input: Record<string, unknown> | null;
  /** Tool calls since the step's input note (or the run's start), oldest first. */
  readonly calls: readonly ToolCall[];
  /** The model's own text in this step, including the stand-in's explicit page decisions. */
  readonly notes?: readonly string[];
  /** The tools offered, by call name. */
  readonly tools: readonly string[];
}

const SKILL_INPUT = `${CONTROL_PREFIX} Skill input:`;

function systemText(system: AnthropicBody['system']): string {
  return typeof system === 'string' ? system : (system ?? []).map((b) => b.text ?? '').join('\n');
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function viewOf(body: AnthropicBody): RequestView {
  const messages = body.messages;
  const start = Math.max(0, runStart(messages));
  // The step starts at its latest input note; a run without skills starts at its message.
  let from = start;
  let input: Record<string, unknown> | null = null;
  for (let i = messages.length - 1; i >= start; i -= 1) {
    const words = messages[i]?.role === 'user' ? said(messages[i]?.content) : '';
    const at = words.indexOf(SKILL_INPUT);
    if (at < 0) continue;
    from = i;
    input = parseObject(words.slice(at + SKILL_INPUT.length).trim());
    break;
  }
  const results = new Map<string, string>();
  for (const message of messages.slice(from))
    if (typeof message.content !== 'string')
      for (const block of message.content)
        if (block.type === 'tool_result' && block.tool_use_id)
          results.set(block.tool_use_id, blockText(block.content));
  const calls: ToolCall[] = [];
  for (const message of messages.slice(from))
    if (message.role === 'assistant' && typeof message.content !== 'string')
      for (const block of message.content)
        if (block.type === 'tool_use' && block.name)
          calls.push({
            ...(block.id ? { id: block.id } : {}),
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
            result: results.get(block.id ?? '') ?? '',
          });
  const skill = /^# Skill: (\S+)$/m.exec(systemText(body.system))?.[1] ?? null;
  return {
    ask: runMessageText(messages),
    skill,
    input,
    calls,
    notes: messages
      .slice(from)
      .filter((message) => message.role === 'assistant')
      .map((message) => said(message.content)),
    tools: (body.tools ?? []).map((tool) => tool.name),
  };
}

/** A tool result's JSON (the part before any untrusted blocks), or null. */
export function resultJson(result: string): Record<string, unknown> | null {
  return parseObject(result.split('\n\n')[0] ?? '');
}

const STORED = /^Stored as (?:artifact|result) (\S+) \(/;
const PAGE = /^Bytes (\d+)-(\d+) of (\d+)\.\n<untrusted source="artifact">\n([\s\S]*)\n<\/untrusted>$/;

/**
 * A result the agent stored as an artifact (over 8 KiB): its id, how far the
 * readArtifact calls after it got, and the JSON once they read it all.
 */
export function storedResult(
  result: string,
  reads: readonly ToolCall[],
): { readonly id: string; readonly next: number; readonly json: Record<string, unknown> | null } | null {
  const id = STORED.exec(result)?.[1];
  if (!id) return null;
  let text = '';
  let next = 0;
  let total = Infinity;
  for (const read of reads) {
    if (read.input.id !== id || read.input.path !== undefined) continue;
    const page = PAGE.exec(read.result);
    if (!page || Number(page[1]) !== next) continue;
    text += page[4];
    next = Number(page[2]);
    total = Number(page[3]);
  }
  return { id, next, json: next >= total ? parseObject(text) : null };
}

/** The text of untrusted block `n` (1-based) in a tool result, or ''. */
export function untrustedBlock(result: string, n: number): string {
  const match = new RegExp(`<untrusted id="${n}"[^>]*>\\n?([\\s\\S]*?)\\n?</untrusted>`).exec(result);
  return match?.[1] ?? '';
}
