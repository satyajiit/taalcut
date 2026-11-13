// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: the prompt held under the model's window (SPEC "Compaction"). A breakdown on the 9B outgrew 32,768 tokens
 * one run in five (`models.context_too_long`): many turns, or retried calls of 1,300 tokens each that saved progress
 * never stood for, because they failed. When a prompt's estimate is over its budget (the window less the answer's
 * room and a margin), older parts are condensed, in this order, until it fits:
 *
 * 1. tool results the model has read (a later turn followed them), the biggest first: images, strips, long texts
 *    become one line saying what they were and how they began;
 * 2. finished steps: each becomes one line, its handoff or its summary;
 * 3. earlier runs of the conversation (history), the oldest first;
 * 4. the current step's older turns, superseded refusals first (a failed call the model made again later), then the
 *    oldest: one note lists what they called and how it went.
 *
 * Never cut: the run's message, every note Taalcut wrote in the current step (its input, failed checks, corrective
 * notes) and its last KEEP_TURNS turns with their results. The same state and window give the same prompt, so a
 * resumed run and a replay (which reads the window from context.compacted) build it again exactly. A prompt under
 * its budget is untouched, byte for byte.
 */
import type { ChatMessage, ContentPart, ToolSpec } from '@taalcut/models';
import { z } from 'zod';
import type { RunState } from '../run-state';
import { CONTROL_PREFIX } from '../prompt';
import type { PromptBlock } from './prompt-block';
import { compactExactResults } from './exact-results';

export type { PromptBlock } from './prompt-block';

/**
 * Estimated tokens of a text, by kind of character, for Qwen's tokenizer: each digit is a token of its own, JSON's
 * punctuation about two to a token, words and spaces about four characters to a token. One rate for all (3 characters
 * a token) said 23,400 for z1's prompt on the 9B, which the server counted as 31,300: eight pages of a breakdown's
 * JSON, a quarter of them digits (ids, times, a fingerprint), 1.75 characters a token.
 */
export function textTokens(text: string): number {
  let digits = 0;
  let punctuation = 0;
  for (const char of text) {
    if (char >= '0' && char <= '9') digits++;
    else if (!/[\p{L}\s]/u.test(char)) punctuation++;
  }
  return digits + Math.ceil(punctuation / 2) + Math.ceil((text.length - digits - punctuation) / 4);
}
/** What an image costs, in estimated tokens (a 1080×1920 frame at the projector's minimum is about 1,100). */
const IMAGE_TOKENS = 1_600;
/** Room for the answer when the run sets no output limit. */
export const ANSWER_TOKENS = 4_096;
/** The share of the window kept free beside the answer: the estimate is not the model's tokenizer. */
export const WINDOW_MARGIN = 0.1;
/** The current step's turns kept whole. */
export const KEEP_TURNS = 4;
/** Results shorter than this are not worth condensing. */
const CONDENSE_FROM_CHARS = 600;
const QUOTE_CHARS = 160;

export interface Compacted {
  readonly messages: ChatMessage[];
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly condensedResults: number;
  readonly droppedTurns: number;
  readonly summarisedSteps: number;
  readonly fits: boolean;
}

const partTokens = (part: ContentPart) => (part.type === 'image' ? IMAGE_TOKENS : textTokens(part.text));

function messageTokens(message: ChatMessage): number {
  if (message.role === 'assistant')
    return (
      message.parts.reduce(
        (sum, part) => sum + textTokens(part.type === 'tool_call' ? JSON.stringify(part.call) : part.text),
        0,
      ) + 8
    );
  const content = message.content;
  return (
    (typeof content === 'string' ? textTokens(content) : content.reduce((s, p) => s + partTokens(p), 0)) + 8
  );
}

/** The prompt's estimated tokens: the system prompt, the tools offered and every message. */
export function estimateTokens(
  system: string,
  tools: readonly ToolSpec[],
  messages: readonly ChatMessage[],
): number {
  const fixed = textTokens(system) + tools.reduce((sum, tool) => sum + toolTokens(tool), 0);
  return fixed + messages.reduce((sum, message) => sum + messageTokens(message), 0);
}

/** A tool's JSON as the model is sent it, measured once per schema. */
const schemaTokens = new WeakMap<object, number>();
function toolTokens(tool: ToolSpec): number {
  let tokens = schemaTokens.get(tool.parameters);
  if (tokens === undefined) {
    try {
      tokens = textTokens(
        JSON.stringify(z.toJSONSchema(tool.parameters, { io: 'input', unrepresentable: 'any' })),
      );
    } catch {
      tokens = 1_000;
    }
    schemaTokens.set(tool.parameters, tokens);
  }
  return tokens + textTokens(`${tool.name} ${tool.description}`);
}

/** What a prompt may take of a window: the window less the answer's room and a margin. */
export function promptBudget(window: number, answerTokens = ANSWER_TOKENS): number {
  return Math.floor(window * (1 - WINDOW_MARGIN)) - answerTokens;
}

const note = (text: string): ChatMessage => ({ role: 'user', content: `${CONTROL_PREFIX} ${text}` });
const contentChars = (content: string | readonly ContentPart[]) =>
  typeof content === 'string'
    ? content.length
    : content.reduce((s, p) => s + (p.type === 'text' ? p.text.length : 6_400), 0);
const firstText = (content: string | readonly ContentPart[]) =>
  typeof content === 'string'
    ? content
    : content.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join(' ');

/** A read result as one line: what it was, and how it began (errors keep their code and reason). */
function condensed(message: Extract<ChatMessage, { role: 'tool' }>, reference?: string): ChatMessage {
  if (reference) return { ...message, content: reference };
  const chars = contentChars(message.content);
  const images =
    typeof message.content === 'string' ? 0 : message.content.filter((p) => p.type === 'image').length;
  const begin = firstText(message.content).replace(/\s+/gu, ' ').slice(0, QUOTE_CHARS);
  const what = images > 0 ? `${images} image(s) and ${chars} characters` : `${chars} characters`;
  return {
    ...message,
    content: `${CONTROL_PREFIX} Condensed: this ${message.toolName} result (${what}) was read in an earlier turn. It began: ${begin} […]`,
  };
}

interface Working {
  blocks: (PromptBlock | undefined)[];
}

const total = (system: string, tools: readonly ToolSpec[], work: Working) =>
  estimateTokens(
    system,
    tools,
    work.blocks.flatMap((b) => b?.messages ?? []),
  );

/**
 * The prompt condensed to `budget` estimated tokens, or undefined when it fits as it is. `current` is the plan step
 * running now (its notes and last turns are never cut).
 */
export function compactPrompt(input: {
  readonly blocks: readonly PromptBlock[];
  readonly state: RunState;
  readonly system: string;
  readonly tools: readonly ToolSpec[];
  readonly budget: number;
  /** Fit a smaller tool offer before replacing unread answers with exact readback handles. */
  readonly unreadReferences?: boolean;
}): Compacted | undefined {
  const { state, system, tools, budget } = input;
  const work: Working = { blocks: [...input.blocks] };
  const beforeTokens = total(system, tools, work);
  if (beforeTokens <= budget) return undefined;
  const current = state.stepIndex;
  const turnIndexes = work.blocks.flatMap((b, i) => (b?.kind === 'turn' ? [i] : []));
  const lastTurns = new Set(turnIndexes.slice(-2));
  const over = () => total(system, tools, work) > budget;
  let condensedResults = 0;
  let droppedTurns = 0;
  let summarisedSteps = 0;

  // A later model turn has consumed these pages. Their assistant decisions and exact read calls remain.
  condensedResults += compactExactResults(work.blocks, turnIndexes.slice(0, -1), over, 'readPages');

  // 1. Read results, biggest first (never in the last two turns: their results may not be read yet).
  const results = turnIndexes
    .filter((i) => !lastTurns.has(i))
    .flatMap((i) =>
      work.blocks[i]!.messages.flatMap((m, j) =>
        m.role === 'tool' && contentChars(m.content) >= CONDENSE_FROM_CHARS
          ? [{ i, j, size: messageTokens(m) }]
          : [],
      ),
    )
    .sort((a, b) => b.size - a.size || a.i - b.i);
  for (const { i, j } of results) {
    if (!over()) break;
    const block = work.blocks[i]!;
    const reference = block.references?.find((ref) => ref.message === j);
    const messages = block.messages.map((m, k) =>
      k === j && m.role === 'tool' ? condensed(m, reference?.content) : m,
    );
    work.blocks[i] = { ...block, messages };
    condensedResults += 1;
  }

  // 2. Finished steps, one line each, oldest first.
  for (const [index, step] of (state.plan ?? []).entries()) {
    if (!over()) break;
    if (index >= current || (step.status !== 'done' && step.status !== 'skipped')) continue;
    const members = work.blocks.flatMap((b, i) => (b && b.step === index ? [i] : []));
    if (members.length === 0) continue;
    const turns = members.filter((i) => work.blocks[i]!.kind === 'turn').length;
    const what = step.skill ? `the ${step.skill} skill` : `"${step.text.slice(0, 80)}"`;
    const outcome = step.handedOff
      ? `it handed off ${(JSON.stringify(step.handedOff.output) ?? 'null').slice(0, 600)}`
      : step.summary
        ? `it said: ${step.summary.slice(0, 400)}`
        : `it ended ${step.status}`;
    const line = note(`Step ${index + 1} (${what}) is done: ${outcome}. Its ${turns} turn(s) are not shown.`);
    work.blocks[members[0]!] = { kind: 'control', messages: [line], step: index };
    for (const i of members.slice(1)) work.blocks[i] = undefined;
    summarisedSteps += 1;
  }

  // 3. Earlier runs of the conversation, oldest first.
  for (const [i, block] of work.blocks.entries()) {
    if (!over()) break;
    if (block?.kind === 'history') work.blocks[i] = undefined;
  }

  // 4. The current step's older turns: superseded refusals, then the oldest, into one note where they began.
  if (over()) droppedTurns = dropOlderTurns(work, current, over);

  // An unread result is never truncated. Its complete validated value is already durable in the run log.
  if (input.unreadReferences !== false)
    condensedResults += compactExactResults(work.blocks, turnIndexes, over, 'references');

  const messages = work.blocks.flatMap((b) => b?.messages ?? []);
  const afterTokens = estimateTokens(system, tools, messages);
  return {
    messages,
    beforeTokens,
    afterTokens,
    condensedResults,
    droppedTurns,
    summarisedSteps,
    fits: afterTokens <= budget,
  };
}

function dropOlderTurns(work: Working, current: number, over: () => boolean): number {
  const turns = work.blocks.flatMap((b, i) => (b?.kind === 'turn' && b.step === current ? [i] : []));
  const droppable = turns.slice(0, Math.max(0, turns.length - KEEP_TURNS));
  if (droppable.length === 0) return 0;
  const later = (i: number, tool: string) =>
    turns.some((t) => t > i && work.blocks[t]?.calls?.some((c) => c.tool === tool));
  const superseded = droppable.filter((i) => {
    const calls = work.blocks[i]!.calls ?? [];
    return calls.length > 0 && calls.every((c) => c.failed && later(i, c.tool));
  });
  const order = [...superseded, ...droppable.filter((i) => !superseded.includes(i))];
  const dropped: { readonly i: number; readonly block: PromptBlock }[] = [];
  let noteAt: number | undefined;
  for (const i of order) {
    if (!over()) break;
    dropped.push({ i, block: work.blocks[i]! });
    // One note where the dropped turns began, counted as the loop goes.
    if (noteAt !== undefined) work.blocks[noteAt] = undefined;
    work.blocks[i] = undefined;
    const sorted = [...dropped].sort((x, y) => x.i - y.i);
    noteAt = sorted[0]!.i;
    const calls = sorted.flatMap((d) => d.block.calls ?? []);
    work.blocks[noteAt] = { kind: 'control', step: current, messages: [droppedNote(calls, dropped.length)] };
  }
  return dropped.length;
}

/** The note in place of dropped turns: what they called and how it went, oldest first. */
export function droppedNote(
  calls: readonly { readonly tool: string; readonly failed?: string }[],
  turns: number,
): ChatMessage {
  const said = calls.map((c) => (c.failed ? `${c.tool} (refused: ${c.failed})` : `${c.tool} (done)`));
  return note(
    `${turns} earlier turn(s) of this step are not shown, to fit the model's window. They called: ${said.join(', ') || 'no tool'}.`,
  );
}
