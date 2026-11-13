// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turn limits (SPEC section 35, LRN1-CTX). A step is capped by its own limit: a skill's `limits.maxTurns`, else the
 * loop's `maxTurnsPerStep`. The run is capped by the loop's `maxTurns` for the turns outside skill steps (planning,
 * plain steps, the report) plus every planned skill step's own limit. So a skill gets its whole budget wherever it
 * runs: in a flow, in a plan a chat ask made, after other steps, and in a run resumed from its log, since both limits
 * are functions of the logged plan and the registered skills alone.
 */
import type { AnySkill } from '@taalcut/core';
import type { LoopSettings } from './context';
import type { SkillRegistry } from './skills';
import { iterationBudget } from './iteration-budget';
import type { RunState, StepState } from './state';

/**
 * The most model turns one step may take. AGT2: a skill step's own limit grows with the window its route was sized
 * by (iteration-budget.ts `turnScale`; the 4B's is the skill's limit as declared).
 */
export function stepTurnLimit(
  skill: AnySkill | undefined,
  loop: LoopSettings,
  step?: Pick<StepState, 'window'>,
): number {
  const own = skill?.limits?.maxTurns;
  if (skill && own === undefined) return loop.maxTurnsPerStep;
  return Math.round((own ?? loop.maxTurnsPerStep) * iterationBudget(step?.window).turnScale);
}

/** The most model turns the whole run may take: the loop's own (scaled for plain steps), plus each planned skill step's. */
export function runTurnLimit(state: RunState, skills: SkillRegistry, loop: LoopSettings): number {
  const plainScale = Math.max(
    1,
    ...(state.plan ?? []).map((step) =>
      !step.skill && !step.tool ? iterationBudget(step.window).turnScale : 1,
    ),
  );
  const base = Math.round(loop.maxTurns * plainScale);
  return (state.plan ?? []).reduce(
    (limit, step) => (step.skill ? limit + stepTurnLimit(skills.get(step.skill), loop, step) : limit),
    base,
  );
}
