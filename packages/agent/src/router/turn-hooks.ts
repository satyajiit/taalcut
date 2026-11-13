// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the router meets the loop: every act turn (modelTurn('act')) asks it, which also covers a plain
 * step's route phase (its first act turn). Plan turns and the agent's own tool steps don't ask. Mode `off`
 * (the default) does nothing at all, so a Phase 2 run's log is unchanged.
 */
import type { ToolCall } from '@taalcut/models';
import type { RunContext } from '../context';
import type { EventInput } from '../run-log';
import { afterLiveTurn, routeBeforeTurn } from './gate';
import { startShadow, type ShadowRoute } from './shadow';

/** Before the turn's tools are chosen: mode `on`'s decision (it may narrow the turn to one family). */
export function beforeActTurn(ctx: RunContext, modelCallId: string): Promise<EventInput[]> {
  return routeBeforeTurn(ctx, modelCallId);
}

/** As the main model's call starts: mode `shadow`'s parallel decision. */
export function shadowActTurn(ctx: RunContext, modelCallId: string): ShadowRoute | undefined {
  return startShadow(ctx, modelCallId);
}

/** With the main model's answer: the decision's record (shadow), an override (on), and telemetry. */
export async function afterActTurn(
  ctx: RunContext,
  modelCallId: string,
  calls: readonly ToolCall[],
  shadow: ShadowRoute | undefined,
): Promise<EventInput[]> {
  return [...((await shadow?.settle(calls)) ?? []), ...afterLiveTurn(ctx, modelCallId, calls)];
}
