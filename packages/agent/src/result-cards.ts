// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A tool's own cards (core's ToolSpec.resultCard and approvalCard, R2): the
 * card for its result in place of its tool row (render.export →
 * renderProgress), and the decision card for its approval in place of the
 * generic one (render.export → exportApproval). Both are logged as
 * `card.sent`. A flow's export keeps one card id per variant, so asking
 * again after a change updates the same card.
 */
import type { AnyTool, Card, ToolCardContext, ToolRunId } from '@taalcut/core';
import type { ToolResult } from '@taalcut/tools';
import type { RunContext } from './context';
import type { EventInput, RunLog } from './run-log';
import type { ToolCallState } from './run-state';
import { exportCardId, placeCard } from './skill-cards';

function cardContext(log: RunLog, toolCallId: string, signal: AbortSignal): ToolCardContext {
  const state = log.state;
  const projectId = state.flow?.projectId ?? state.started?.projectId;
  return {
    runId: log.runId,
    toolCallId: toolCallId as ToolRunId,
    projectId: (projectId ?? null) as ToolCardContext['projectId'],
    signal,
  };
}

/** card.sent for the call's result card, when its tool has one (never in replay). */
export async function resultCardEvents(
  ctx: RunContext,
  call: ToolCallState,
  result: ToolResult,
): Promise<EventInput[]> {
  const spec = ctx.registry.resolve(call.requested.tool, result.version || undefined)?.spec;
  if (!spec?.resultCard || ctx.phase2.replay) return [];
  try {
    const card = await spec.resultCard(
      result.value as never,
      cardContext(ctx.log, call.requested.toolCallId, ctx.signal),
    );
    const placed = card.ok && card.value ? placeCard(card.value, card.value.id, undefined) : undefined;
    return placed ? [['card.sent', { card: placed, toolCallId: call.requested.toolCallId }]] : [];
  } catch {
    return [];
  }
}

/**
 * The tool's decision card for an approval it asked for. A flow's export
 * step uses `export:<flowId>:<variant>`; anything else the card's own id.
 */
export async function approvalCardFor(
  log: RunLog,
  spec: AnyTool,
  toolCallId: string,
  input: unknown,
  approvalId: string,
): Promise<Card | undefined> {
  if (!spec.approvalCard) return undefined;
  const signal = new AbortController().signal;
  try {
    const card = await spec.approvalCard(input as never, {
      ...cardContext(log, toolCallId, signal),
      approvalId,
    });
    if (!card.ok) return undefined;
    const state = log.state;
    const step = state.plan?.find((s) => s.tool && s.toolCallId === toolCallId);
    return placeCard(card.value, step ? exportCardId(state, step) : card.value.id, undefined);
  } catch {
    return undefined;
  }
}
