// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The skill contract (P2-T5, P2-M12): a skill is a model-run step with a
 * typed input, a typed handoff, the only tools it may use, an optional
 * deterministic check and an optional live card. Domain packages declare
 * their skills (templates' Analyst, timeline's Librarian and Editor, render's
 * Reviewer) with defineSkill and export a SkillModule; @taalcut/agent runs
 * them in flows. Like tools, skills are plain data checked in one place.
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { FlowId, ProjectId, RunId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { Card } from '../cards/cards';
import type { ModelModuleId } from '../ports/model-ports';
import type { ToolCostEstimate } from '../tools/contract';
import { SKILL_ID_PATTERN, SKILL_QUESTIONS, type EntityRef, type SkillQuestion } from './skill-refs';

export interface SkillContext {
  readonly runId: RunId;
  readonly projectId: ProjectId | null;
  readonly flowId: FlowId | null;
  readonly stepId: string;
  readonly signal: AbortSignal;
}

/** What a skill's check gets (round P3-3): the step's context and the validated input the step began with. */
export interface SkillVerifyContext<I = unknown> extends SkillContext {
  /**
   * The step's input, as parsed when it began. The agent's runner always passes it; a direct call (a test, a
   * check written before round P3-3) may not, so a check that uses it falls back to what it can read itself.
   */
  readonly input?: I;
}

export type SkillVerdict =
  | { readonly verdict: 'pass' }
  /** `reason` is model-facing; it goes back as a `[Taalcut] Check failed` note. */
  | { readonly verdict: 'retry'; readonly reason: string }
  | { readonly verdict: 'fail'; readonly reason: string };

/** Method syntax on purpose: it keeps a specific skill assignable to AnySkill. */
export interface SkillSpec<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> {
  readonly id: string;
  /** Semver; bump the major when input or output changes incompatibly. */
  readonly version: string;
  /** i18n key of the skill's name on step cards and seeded plan steps. */
  readonly labelKey: string;
  /** Model-facing, one line, shown in the catalogue. */
  readonly description: string;
  /** Model-facing instructions, added to the system prompt while the skill runs. */
  readonly prompt: string;
  /** The only tools the skill's turns may load or call. */
  readonly tools: { readonly names?: readonly string[]; readonly families?: readonly string[] };
  /**
   * Of those, the tools a step may not load or call given its input (BRK1-MAKE). The Librarian given a template
   * leaves out the tools that would choose or plan another. Absent: every tool in `tools`.
   */
  withheldTools?(input: z.output<I>): readonly string[];
  readonly input: I;
  /** The handoff: the parameters of the agent's `handOff` pseudo-tool. */
  readonly output: O;
  refs(output: z.output<O>): readonly EntityRef[];
  /** The step's live card; re-sent under the same id when a ref changes. */
  card?(output: z.output<O>, ctx: SkillContext): AsyncResult<Card | undefined>;
  /**
   * The second method: a deterministic check before the handoff is accepted. `ctx.input` is the step's input,
   * so the check can look at exactly what the step was given (the slots, the gaps) rather than re-read them.
   */
  verify?(output: z.output<O>, ctx: SkillVerifyContext<z.output<I>>): AsyncResult<SkillVerdict>;
  /** Cost of the skill's paid tools, before it starts (G8). Absent: only its model turns cost. */
  estimate?(input: z.output<I>, ctx: SkillContext): AsyncResult<ToolCostEstimate>;
  readonly questions?: readonly SkillQuestion[];
  /** Module whose model chain runs the skill's turns. Default 'agent'. */
  readonly module?: ModelModuleId;
  /** expectedTurns feeds the estimate (default 4); maxTurns caps the step (default: the loop's). */
  readonly limits?: { readonly expectedTurns?: number; readonly maxTurns?: number };
}

export type AnySkill = SkillSpec<z.ZodObject, z.ZodObject>;

export interface SkillModule {
  /** Lowercase letters and digits; every skill id starts with `<id>.`. */
  readonly id: string;
  readonly skills: readonly AnySkill[];
}

/** Identity helper that infers the input and output types, so refs, card and verify are typed. */
export function defineSkill<I extends z.ZodObject, O extends z.ZodObject>(
  spec: SkillSpec<I, O>,
): SkillSpec<I, O> {
  return spec;
}

export function defineSkillModule(module: SkillModule): SkillModule {
  return module;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MODULE_ID = /^[a-z][a-z0-9]*$/;

function jsonSchemaProblem(schema: z.ZodType): string | null {
  try {
    z.toJSONSchema(schema, { io: 'input' });
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/**
 * Everything wrong with a skill's metadata, as developer-facing messages: the id pattern, semver, a
 * label key, a non-empty prompt, a non-empty tool subset, object schemas that convert to JSON Schema,
 * known questions and sane limits. Empty means the skill can be registered.
 */
export function skillSpecProblems(skill: AnySkill): string[] {
  const problems: string[] = [];
  const add = (message: string) => problems.push(`${skill.id || '<unnamed>'}: ${message}`);
  if (!SKILL_ID_PATTERN.test(skill.id)) add("id must look like 'module.camelCase'");
  if (!SEMVER.test(skill.version)) add(`version '${skill.version}' is not semver (x.y.z)`);
  if (skill.labelKey.trim().length === 0) add('labelKey is empty');
  if (skill.description.trim().length === 0) add('description is empty');
  if (skill.prompt.trim().length === 0) add('prompt is empty');
  if ((skill.tools.names?.length ?? 0) + (skill.tools.families?.length ?? 0) === 0)
    add('tools must name at least one tool or family');
  for (const [part, schema] of [
    ['input', skill.input],
    ['output', skill.output],
  ] as const) {
    if (!(schema instanceof z.ZodObject)) add(`${part} must be a z.object`);
    else {
      const problem = jsonSchemaProblem(schema);
      if (problem) add(`${part} must convert to JSON Schema (${problem})`);
    }
  }
  for (const question of skill.questions ?? [])
    if (!SKILL_QUESTIONS.includes(question)) add(`unknown question '${question}'`);
  const { expectedTurns, maxTurns } = skill.limits ?? {};
  for (const [name, value] of [
    ['expectedTurns', expectedTurns],
    ['maxTurns', maxTurns],
  ] as const)
    if (value !== undefined && (!Number.isInteger(value) || value < 1))
      add(`limits.${name} must be a positive integer`);
  if (expectedTurns !== undefined && maxTurns !== undefined && expectedTurns > maxTurns)
    add('limits.expectedTurns must not exceed maxTurns');
  return problems;
}

/** Problems with a module and every skill in it. Skill ids must start with the module id. */
export function skillModuleProblems(module: SkillModule): string[] {
  const problems: string[] = [];
  if (!MODULE_ID.test(module.id))
    problems.push(`module '${module.id}': id must be lowercase letters and digits`);
  if (module.skills.length === 0) problems.push(`module '${module.id}': has no skills`);
  const seen = new Set<string>();
  for (const skill of module.skills) {
    if (!skill.id.startsWith(`${module.id}.`))
      problems.push(`${skill.id}: id must start with '${module.id}.'`);
    if (seen.has(skill.id)) problems.push(`${skill.id}: declared twice`);
    seen.add(skill.id);
    problems.push(...skillSpecProblems(skill));
  }
  return problems;
}
