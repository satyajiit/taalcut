// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE: the tools a skill step may not load or call given its input (core's `SkillSpec.withheldTools`). They
 * are left out of the step's offer, its search, its system prompt's tool list, and its calls. On the owner's paste
 * the Librarian, given the reel's template, planned a generic video instead; given a template it now has no tool to.
 */
import type { AnySkill } from '@taalcut/core';
import type { RunContext } from './context';
import type { StepState } from './run-state';

const NONE: ReadonlySet<string> = new Set();

/** The skill's withheld tools for this input; none when the skill declares none or the input doesn't parse. */
export function withheldTools(skill: AnySkill, input: unknown): ReadonlySet<string> {
  if (!skill.withheldTools || input === undefined) return NONE;
  const parsed = skill.input.safeParse(input);
  if (!parsed.success) return NONE;
  try {
    return new Set(skill.withheldTools(parsed.data));
  } catch {
    return NONE;
  }
}

/** The step's withheld tools, from the input it was entered with. */
export function stepWithheld(
  skill: AnySkill,
  step: Pick<StepState, 'entered'> | undefined,
): ReadonlySet<string> {
  return withheldTools(skill, step?.entered?.input);
}

/** May this skill step load or call the tool (canonical name)? The skill's subset, less what it withholds. */
export function stepAllows(
  ctx: Pick<RunContext, 'skills'>,
  skill: AnySkill,
  step: Pick<StepState, 'entered'> | undefined,
): (name: string) => boolean {
  const withheld = stepWithheld(skill, step);
  return (name) => ctx.skills.allows(skill, name) && !withheld.has(name);
}
