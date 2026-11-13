// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a skill step's handoff still lacks and which of the step's tools return it, read from the schemas alone: the
 * handoff's required fields, less the ones the step's completed calls returned, against each tool's output fields.
 * The corrective note names those tools (correction.ts); a bounded offer keeps them ahead of work the step has
 * already done (tool-priority.ts).
 */
import { z } from 'zod';
import type { RunContext } from '../context';
import { META_TOOLS } from '../meta-tools';
import type { RunState, StepState, ToolCallState } from '../run-state';
import { SKILL_META_TOOLS } from '../skill-tools';
import { stepAllows } from '../skill-withheld';

export interface HandoffNeeds {
  /** The step's tool calls, in the order the model asked. */
  readonly calls: readonly ToolCallState[];
  /** The handoff schema's required top-level fields. */
  readonly required: string[];
  /** What the step's tools returned, latest last: a field seen there can go in the handoff as it is. */
  readonly seen: ReadonlyMap<string, unknown>;
  readonly missing: string[];
  /** The step's named and family tools, within the same input boundary as its calls. */
  readonly tools: string[];
  /** The tools that return the most of what's missing (planFromFormat returns a templateId, assemble the rest). */
  readonly givers: string[];
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function stepCalls(state: RunState, step: StepState): ToolCallState[] {
  const index = state.plan?.indexOf(step) ?? -1;
  return state.transcript.flatMap((item) =>
    item.kind === 'assistant' && item.step === index
      ? item.toolCallIds.flatMap((id) => (state.toolCalls[id] ? [state.toolCalls[id]!] : []))
      : [],
  );
}

function requiredFields(schema: z.ZodType): string[] {
  try {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as { required?: unknown };
    return Array.isArray(json.required)
      ? json.required.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
}

function offered(ctx: RunContext, step: StepState): string[] {
  const skill = ctx.skills.get(step.skill ?? '');
  if (!skill) return [];
  const names = ctx.skills.subset(skill).filter(stepAllows(ctx, skill, step));
  const withheld = new Set([...META_TOOLS, ...SKILL_META_TOOLS]);
  return names.filter((name) => !withheld.has(name) && ctx.registry.resolve(name) !== undefined);
}

function outputFields(ctx: RunContext, tool: string): string[] {
  const output = record(ctx.registry.resolve(tool)?.schemas.output);
  return Object.keys(record(output?.properties) ?? {});
}

export function handoffNeeds(ctx: RunContext, step: StepState): HandoffNeeds {
  const skill = ctx.skills.get(step.skill ?? '');
  const calls = stepCalls(ctx.log.state, step);
  const seen = new Map<string, unknown>();
  for (const call of calls) {
    const outcome = call.outcome;
    if (call.requested.meta || outcome?.kind !== 'completed' || outcome.payload.output.kind !== 'inline')
      continue;
    for (const [key, value] of Object.entries(record(outcome.payload.output.value) ?? {}))
      seen.set(key, value);
  }
  const required = skill ? requiredFields(skill.output) : [];
  const missing = required.filter((key) => !seen.has(key));
  const tools = offered(ctx, step);
  const covers = new Map(
    tools.map((tool) => [tool, outputFields(ctx, tool).filter((key) => missing.includes(key)).length]),
  );
  const most = Math.max(0, ...covers.values());
  const givers = most > 0 ? tools.filter((tool) => covers.get(tool) === most) : [];
  return { calls, required, seen, missing, tools, givers };
}
