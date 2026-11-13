// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `router.decision` (core's launch telemetry, C-20): enums and booleans only, never a family name or text.
 * Sent once per decision when the main model's answer is known. Never from a replay or a Local only run, and
 * a failing sink never fails the run.
 */
import type { ProjectId } from '@taalcut/core';
import type { RouterAnswerLog } from '../phase3-events';
import type { RunContext } from '../context';
import { NONE_FAMILY } from './families';
import { routerMode } from './route-ask';

export function confidenceBand(confidence: number): 'low' | 'mid' | 'high' {
  return confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'mid' : 'low';
}

export function recordDecision(
  ctx: Pick<RunContext, 'phase2' | 'log'>,
  answer: RouterAnswerLog | undefined,
  outcome: 'answered' | 'timeout' | 'error',
  main: string,
): void {
  const state = ctx.log.state;
  if (ctx.phase2.replay || state.started?.localOnly) return;
  const projectId = state.flow?.projectId ?? state.started?.projectId;
  try {
    ctx.phase2.telemetry.record(
      {
        name: 'router.decision',
        mode: routerMode(state),
        agree: answer?.choice === main,
        routerNone: answer?.choice === NONE_FAMILY,
        mainNone: main === NONE_FAMILY,
        confidence: confidenceBand(answer?.confidence ?? 0),
        outcome,
      },
      projectId ? { projectId: projectId as ProjectId } : undefined,
    );
  } catch {
    // Telemetry never fails a run.
  }
}
