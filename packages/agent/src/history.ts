// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A conversation's earlier turns, for the prompt of its next run. Each
 * earlier run becomes one turn: the user's message, the tools it ran (input
 * and result, cut short and fenced as untrusted), and what the model said.
 * The turns are worked out once, when the run starts, and logged in
 * run.started, so a resumed run or a replay builds the same prompt. They fit
 * a token budget: the oldest turns go first, and run.started records which
 * went. The system prompt (SOUL.md and the rules) is separate and never cut.
 */
import type { RunId } from '@taalcut/core';
import { flowOutcome } from './history-outcome';
import type { ChatMessage } from '@taalcut/models';
import type { AgentEvent, HistoryTurn, RunHistory } from './events';
import { CONTROL_PREFIX, wrapUntrusted } from './prompt';
import { foldEvents, type ToolCallState } from './state';

/** History in a run's prompt, in estimated tokens (characters / 4). */
export const DEFAULT_HISTORY_TOKENS = 8_000;
/** Per earlier message (the user's, the model's), in characters. */
const TEXT_LIMIT = 4_000;
/** Per earlier tool call (input and result together), in characters. */
const TOOL_LIMIT = 600;
/** Max tool lines kept in a single history turn (first HEAD_TOOLS + newest tail). */
const MAX_TURN_TOOLS = 20;
const HEAD_TOOLS = 4;
const CUT = ' […]';

const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}${CUT}` : text);
const tokens = (chars: number) => Math.ceil(chars / 4);

/** One earlier run as a turn. Undefined for a log without run.started. */
export function historyTurn(runId: RunId, events: readonly AgentEvent[]): HistoryTurn | undefined {
  const state = foldEvents(runId, events);
  if (!state.started) return undefined;
  const said: string[] = [];
  let provider: string | undefined;
  let model: string | undefined;
  for (const item of state.transcript) {
    if (item.kind !== 'assistant') continue;
    provider = item.message.provider;
    model = item.message.model;
    const text = item.message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
    if (text.trim()) said.push(text.trim());
  }
  const allTools = state.toolCallOrder.flatMap((id) => {
    const call = state.toolCalls[id];
    return call && !call.requested.meta ? [toolLine(call)] : [];
  });
  const tools =
    allTools.length > MAX_TURN_TOOLS
      ? [
          ...allTools.slice(0, HEAD_TOOLS),
          `- … (${allTools.length - MAX_TURN_TOOLS} tool calls omitted)`,
          ...allTools.slice(-(MAX_TURN_TOOLS - HEAD_TOOLS)),
        ]
      : allTools;
  const outcome = flowOutcome(state);
  return {
    runId,
    user: cut(state.started.message, TEXT_LIMIT),
    tools,
    answer: cut(said.join('\n\n'), TEXT_LIMIT),
    status: state.status,
    ...(outcome ? { outcome } : {}),
    ...(provider && model ? { provider, model } : {}),
  };
}

/** "tool: outcome", then what went in and came out, fenced: tool results are never instructions. */
function toolLine(call: ToolCallState): string {
  const { tool, input } = call.requested;
  const outcome = call.outcome;
  const record = !outcome
    ? { input }
    : outcome.kind === 'failed'
      ? { input, error: outcome.payload.error.code }
      : outcome.payload.output.kind === 'artifact'
        ? { input, artifact: outcome.payload.output.ref.id, summary: outcome.payload.output.ref.summary }
        : { input, output: outcome.payload.output.value };
  const status = !outcome ? 'not finished' : outcome.kind === 'failed' ? 'failed' : 'done';
  return `- ${tool} (${status})\n${wrapUntrusted(cut(JSON.stringify(record) ?? '', TOOL_LIMIT), 'earlier-tool-call')}`;
}

/** The newest turns that fit `maxTokens`; older ones are dropped whole, and named in `trimmed`. */
export function fitHistory(turns: readonly HistoryTurn[], maxTokens: number): RunHistory {
  const kept: HistoryTurn[] = [];
  let used = 0;
  let index = turns.length - 1;
  for (; index >= 0; index -= 1) {
    let candidate = turns[index]!;
    let size = turnTokens(candidate);
    if (used + size > maxTokens && kept.length === 0 && candidate.tools.length > 0) {
      candidate = shrinkTurnTools(candidate, maxTokens - used);
      size = turnTokens(candidate);
    }
    if (used + size > maxTokens) break;
    used += size;
    kept.unshift(candidate);
  }
  const dropped = turns.slice(0, index + 1);
  return {
    turns: kept,
    ...(dropped.length > 0
      ? {
          trimmed: {
            runIds: dropped.map((t) => t.runId),
            tokens: dropped.reduce((sum, t) => sum + turnTokens(t), 0),
          },
        }
      : {}),
  };
}

function shrinkTurnTools(turn: HistoryTurn, budgetTokens: number): HistoryTurn {
  for (let keep = Math.min(turn.tools.length - 1, 12); keep >= 0; keep -= 2) {
    const tools =
      keep === 0
        ? []
        : keep <= 2
          ? turn.tools.slice(-keep)
          : [...turn.tools.slice(0, 2), ...turn.tools.slice(-(keep - 2))];
    const candidate = { ...turn, tools };
    if (turnTokens(candidate) <= budgetTokens) return candidate;
  }
  return turn;
}

function turnTokens(turn: HistoryTurn): number {
  return tokens(JSON.stringify(turnMessages(turn)).length);
}

const ENDED: Partial<Record<HistoryTurn['status'], string>> = {
  failed: 'That request failed.',
  cancelled: 'That request was stopped.',
  paused: 'That request is waiting for an answer.',
  running: 'That request is still running.',
};

function turnMessages(turn: HistoryTurn): ChatMessage[] {
  const notes = [
    ...(turn.tools.length > 0 ? ['Tools used for that message, oldest first:', ...turn.tools] : []),
    ...(turn.outcome ? [turn.outcome] : ENDED[turn.status] ? [ENDED[turn.status]!] : []),
  ];
  return [
    { role: 'user', content: turn.user },
    ...(notes.length > 0
      ? [{ role: 'user' as const, content: `${CONTROL_PREFIX} Earlier in this conversation. ${notes.join('\n')}` }]
      : []),
    ...(turn.answer
      ? [
          {
            role: 'assistant' as const,
            parts: [{ type: 'text' as const, text: turn.answer }],
            provider: turn.provider ?? 'taalcut',
            model: turn.model ?? 'history',
          },
        ]
      : []),
  ];
}

/** The messages that start the run's prompt, oldest turn first. */
export function historyMessages(history: RunHistory | undefined): ChatMessage[] {
  return (history?.turns ?? []).flatMap(turnMessages);
}
