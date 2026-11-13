// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Rebuilds the model's message list from the folded run state, on every call
 * and after a resume: the conversation's earlier turns (logged in
 * run.started), the user message, each model turn, each tool outcome (in the
 * order the model asked), and the agent's own step notes.
 *
 * Saved progress (LRN1-CTX, SPEC "Saved progress"): within a stretch of model
 * turns (no user message or note between them, as in one skill step), once a
 * call of a `savesProgress` tool has succeeded, the turns before it are one
 * note: what they read is stored, and a long job done a page at a time keeps
 * the same prompt size as the pages grow. The turn with the latest such call
 * and everything after it stay in full. A run with no such call builds the
 * same list as before, byte for byte.
 */
import type { ChatMessage } from '@taalcut/models';
import type { PromptBlock } from './context/compaction';
import { readPages, resultReferences } from './context/result-references';
import type { ToolRegistry } from '@taalcut/tools';
import { historyMessages } from './history';
import { CONTROL_PREFIX, renderOutput, wrapUntrusted } from './prompt';
import type { RunState, ToolCallState, TranscriptItem } from './state';

export { CONTROL_PREFIX } from './prompt';

type Registry = Pick<ToolRegistry, 'resolve'>;
type Turn = Extract<TranscriptItem, { kind: 'assistant' }>;

export function buildMessages(state: RunState, registry: Registry): ChatMessage[] {
  return buildPromptBlocks(state, registry).flatMap((block) => block.messages);
}

/**
 * The same messages in pieces, one per transcript item (the conversation's history first), with the step each was
 * written in and a turn's calls: what compaction condenses (context/compaction.ts).
 */
export function buildPromptBlocks(state: RunState, registry: Registry): PromptBlock[] {
  const blocks: PromptBlock[] = historyMessages(state.started?.history).map((message) => ({
    kind: 'history',
    messages: [message],
  }));
  const hidden = savedTurns(state, registry);
  let noted = false;
  for (const [index, item] of state.transcript.entries()) {
    const step = item.step === undefined ? {} : { step: item.step };
    const saved = hidden.get(index);
    if (saved) {
      // One note in place of the whole hidden stretch, where it began.
      if (!noted)
        blocks.push({ kind: 'saved', messages: [{ role: 'user', content: savedNote(saved) }], ...step });
      noted = true;
      continue;
    }
    noted = false;
    if (item.kind === 'user')
      blocks.push({ kind: 'user', messages: [{ role: 'user', content: item.text }], ...step });
    else if (item.kind === 'control')
      blocks.push({
        kind: 'control',
        messages: [{ role: 'user', content: `${CONTROL_PREFIX} ${item.text}` }],
        ...step,
      });
    else
      blocks.push({
        kind: 'turn',
        messages: turnMessages(state, item, registry),
        references: resultReferences(state, item),
        readPages: readPages(state, item),
        calls: turnCalls(state, item),
        ...step,
      });
  }
  return blocks;
}

/** A turn's calls and how each ended, for compaction's note. */
function turnCalls(state: RunState, item: Turn): { tool: string; failed?: string }[] {
  return item.toolCallIds.flatMap((id) => {
    const call = state.toolCalls[id];
    if (!call) return [];
    const failed = call.outcome?.kind === 'failed' ? call.outcome.payload.error.code : undefined;
    return [{ tool: call.requested.tool, ...(failed ? { failed } : {}) }];
  });
}

function turnMessages(state: RunState, item: Turn, registry: Registry): ChatMessage[] {
  const messages: ChatMessage[] = [item.message];
  for (const id of item.toolCallIds) {
    const call = state.toolCalls[id];
    if (!call?.outcome) continue;
    const { content, isError } = renderToolMessage(call, registry);
    messages.push({
      role: 'tool',
      toolCallId: call.requested.modelToolCallId,
      toolName: call.requested.callName,
      content,
      ...(isError ? { isError } : {}),
    });
  }
  return messages;
}

/** The tool whose call saved them, and how many turns and calls are hidden, for each hidden turn's index. */
interface Saved {
  readonly tool: string;
  readonly turns: number;
  readonly calls: number;
}

/**
 * The turns a later successful `savesProgress` call stands for: in each stretch of consecutive model turns, every
 * turn before the last one with such a call.
 */
function savedTurns(state: RunState, registry: Registry): Map<number, Saved> {
  const hidden = new Map<number, Saved>();
  let stretch: number[] = [];
  const close = () => {
    const saves = stretch.map((index) => savingTool(state, state.transcript[index], registry));
    const last = saves.findLastIndex((tool) => tool !== undefined);
    const tool = saves[last];
    if (tool !== undefined && last > 0) {
      const before = stretch.slice(0, last);
      const calls = before.reduce((sum, index) => sum + callsIn(state.transcript[index]), 0);
      for (const index of before) hidden.set(index, { tool, turns: before.length, calls });
    }
    stretch = [];
  };
  for (const [index, item] of state.transcript.entries()) {
    if (item.kind === 'assistant') stretch.push(index);
    else close();
  }
  close();
  return hidden;
}

/** The `savesProgress` tool this turn called successfully, if any. */
function savingTool(
  state: RunState,
  item: TranscriptItem | undefined,
  registry: Registry,
): string | undefined {
  if (item?.kind !== 'assistant') return undefined;
  for (const id of item.toolCallIds) {
    const call = state.toolCalls[id];
    if (call?.outcome?.kind !== 'completed' || call.requested.meta) continue;
    const tool = registry.resolve(call.requested.tool, call.outcome.payload.version);
    if (tool?.descriptor.savesProgress) return call.requested.tool;
  }
  return undefined;
}

const callsIn = (item: TranscriptItem | undefined) =>
  item?.kind === 'assistant' ? item.toolCallIds.length : 0;

/**
 * The note in place of the hidden turns. It says how many there were: the model's turn count stays readable from the
 * prompt alone (a recorded session numbers each request by it, apps/gate-demo `runTurn`).
 */
function savedNote({ tool, turns, calls }: Saved): string {
  return `${CONTROL_PREFIX} ${tool} saved the work of this step's ${turns} earlier turns, so their ${calls} tool calls and results are not shown. Its latest result follows.`;
}

export function renderToolMessage(
  call: ToolCallState,
  registry: Registry,
): { content: string; isError: boolean } {
  const outcome = call.outcome;
  if (!outcome) return { content: '', isError: false };
  if (outcome.kind === 'failed') {
    const { code, detail } = outcome.payload.error;
    return { content: detail ? `Error ${code}: ${detail}` : `Error ${code}`, isError: true };
  }
  const { output } = outcome.payload;
  if (output.kind === 'artifact') {
    const { ref } = output;
    // Summaries can quote the stored content, so they are fenced like any media text.
    return {
      content: `Stored as artifact ${ref.id} (${ref.mediaType}, ${ref.bytes} bytes). Call readArtifact to read it. Summary:\n${wrapUntrusted(ref.summary, 'artifact-summary')}`,
      isError: false,
    };
  }
  if (call.requested.meta) {
    // Pseudo-tools return agent-written text, except readArtifact, which wraps its own output.
    return {
      content: typeof output.value === 'string' ? output.value : JSON.stringify(output.value),
      isError: false,
    };
  }
  const schema = registry.resolve(call.requested.tool, outcome.payload.version)?.schemas.output;
  return { content: renderOutput(output.value, schema), isError: false };
}
