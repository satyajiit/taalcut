// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which skill steps are offered all their tools on every turn (LRN1-CTX, SPEC 34 and 35; AGT2: sized by the window,
 * tool-offer.ts): the tool offer (`turn-context.ts`), the route's log (`skill-step.ts`) and the skill's prompt
 * (`skill-prompt.ts`, which then carries no tool catalogue) all read it.
 */
import type { AnySkill } from '@taalcut/core';
import type { RunContext } from './context';
import { toolOffer, type ToolOffer } from './tool-offer';
import type { StepState } from './run-state';

/**
 * True when the step is offered every tool it allows: on a window that offers them all, or for a skill that names
 * all its tools (no family) and few enough for one turn. None is missing, so it never spends a turn on findTools.
 */
export function offeredWhole(skill: AnySkill, offer: ToolOffer): boolean {
  if (offer.all) return true;
  return !skill.tools.families?.length && (skill.tools.names?.length ?? 0) <= offer.turn;
}

/** The offer a step's route logged (its window); the smallest before its route ran. */
export function stepOffer(step: Pick<StepState, 'window'> | undefined): ToolOffer {
  return toolOffer(step?.window);
}

/**
 * The window a step's route is sized by, read once when it starts: the smallest of its module's chain now, or, in a
 * replay, the one its route logged (a replay's own window is the compacted turn's, not the route's).
 */
export function routeWindow(
  ctx: Pick<RunContext, 'contextWindow' | 'phase2'>,
  module: string,
): number | undefined {
  const replay = ctx.phase2.replay;
  if (replay) return replay.nextRouteWindow?.();
  return ctx.contextWindow?.(module);
}
