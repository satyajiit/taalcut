// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A planned edit (P3-V9 cleanup, P3-V12 energy curve) is two tools. The plan tool is a read: it makes the plan,
 * keeps it as a JSON artifact and answers a short summary with the artifact's ref. The apply tool is an edit command
 * tool that takes the plan's artifact id, reads the plan back, checks it with the plan's own schema and dispatches
 * its command in one undo step. The model never copies a plan back.
 */
import {
  defineTool,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  type AnyTool,
  type ArtifactRef,
  type AsyncResult,
} from '@taalcut/core';
import { z } from 'zod';
import { editCommandTool } from './edit-command-tool';
import type { TimelineService } from '../service/service';
import { readPlan, storePlan, type ReadPlan } from './plan-artifacts';

interface ToolText {
  readonly description: string;
  readonly summary: string;
  readonly tags: readonly string[];
}

/** What a plan tool's `make` hands back: the plan to keep, the artifact's one line, and the answer around its ref. */
export interface MadePlan<Answer> {
  readonly kept: unknown;
  readonly note: string;
  answer(plan: ArtifactRef): Answer;
}

export interface PlanToolSpec<I extends z.ZodType, O extends z.ZodType> extends ToolText {
  readonly name: string;
  readonly input: I;
  readonly output: O;
  readonly timeoutMs: number;
  make(input: z.output<I>): AsyncResult<MadePlan<z.input<O>>>;
}

/** The read tool that makes a plan and keeps it as an artifact. */
export function planTool<I extends z.ZodType, O extends z.ZodType>(spec: PlanToolSpec<I, O>): AnyTool {
  const tool = defineTool({
    name: spec.name,
    version: '1.0.0',
    description: spec.description,
    summary: spec.summary,
    tags: spec.tags,
    input: spec.input,
    output: spec.output,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: spec.timeoutMs,
    retry: NO_TOOL_RETRY,
    run: async (input, ctx) => {
      const made = await spec.make(input);
      if (!made.ok) return made;
      const artifact = await storePlan(ctx.artifacts, made.value.kept, made.value.note);
      return artifact.ok ? ok(made.value.answer(artifact.value)) : artifact;
    },
  });
  return tool as AnyTool;
}

/** An apply tool's input: the video and the artifact the plan tool returned. */
export function appliedPlanInputSchema(planTool: string) {
  return z.object({
    projectId: ulidSchema('Project'),
    timelineId: ulidSchema('Timeline'),
    revision: z.int().positive().optional(),
    plan: ulidSchema('Artifact').describe(`The artifact ${planTool} returned`),
  });
}

export type AppliedPlanInput = z.output<ReturnType<typeof appliedPlanInputSchema>>;

export interface ApplyToolSpec<S extends z.ZodType> extends ToolText {
  /** The command it dispatches, also the tool's name. */
  readonly command: string;
  readonly service?: Pick<TimelineService, 'read'>;
  readonly input: ReturnType<typeof appliedPlanInputSchema>;
  /** The schema the kept plan must still match. */
  readonly kept: S;
  /** The command's payload from the tool's input and the kept plan. */
  payload(input: AppliedPlanInput, kept: ReadPlan<z.output<S>>): unknown;
}

/** The write tool that applies a kept plan by its artifact id, in one undo step. */
export function applyPlanTool<S extends z.ZodType>(spec: ApplyToolSpec<S>): AnyTool {
  return editCommandTool({
    command: spec.command,
    service: spec.service,
    description: spec.description,
    summary: spec.summary,
    tags: spec.tags,
    input: spec.input,
    payload: async (input, artifacts) => {
      const kept = await readPlan(artifacts, input.plan, spec.kept);
      if (!kept.ok) return kept;
      const made = spec.payload(input, kept.value);
      return ok(made && typeof made === 'object' ? { ...made, revision: input.revision } : made);
    },
  });
}
