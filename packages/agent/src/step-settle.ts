// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Step handoff payload storage and step estimate / open-card settlement on completion or failure.
 */
import type { AnySkill } from '@taalcut/core';
import { contentHash } from '@taalcut/tools';
import type { RunContext } from './context';
import { actualSince } from './costs';
import type { EventInput } from './run-log';
import type { StepState } from './run-state';
import { failedStepCardEvents } from './skill-cards';

/** Handoffs over this many bytes are stored as artifacts, like large tool results. */
const INLINE_HANDOFF_BYTES = 8 * 1024;

export async function handoffPayload(
  ctx: RunContext,
  step: StepState,
  skill: AnySkill,
  output: unknown,
  settled = false,
) {
  let refs: ReturnType<AnySkill['refs']>;
  try {
    refs = skill.refs(output as never);
  } catch {
    refs = [];
  }
  const json = JSON.stringify(output) ?? 'null';
  const base = {
    stepId: step.id,
    skill: skill.id,
    version: skill.version,
    outputHash: contentHash(output),
    refs: [...refs],
    ...(settled ? { settled: true as const } : {}),
  };
  // A settled handoff stays inline: the step's own (the model's) is what the state falls back to otherwise.
  if (settled || json.length <= INLINE_HANDOFF_BYTES || !ctx.artifacts) return { ...base, output };
  const stored = await ctx.artifacts.put({
    mediaType: 'application/json',
    data: json,
    summary: `The ${skill.id} handoff (${json.length} bytes).`,
  });
  return stored.ok
    ? { ...base, artifact: { id: stored.value.id, bytes: stored.value.bytes } }
    : { ...base, output };
}

/** estimate.settled for the step's estimate: what it really cost. */
export function settleEvents(ctx: RunContext, step: StepState): EventInput[] {
  if (!step.estimateId || ctx.log.state.estimates[step.estimateId]?.settled) return [];
  const actual = actualSince(ctx.log.state.usage, step.entered?.usage);
  return [['estimate.settled', { estimateId: step.estimateId, actual }]];
}

/** Events that settle an active step's status, estimate and open step card before run.failed. */
export function failStepEvents(ctx: RunContext, step: StepState | undefined): EventInput[] {
  if (!step || step.status !== 'doing') return [];
  return [
    ['verify.result', { stepId: step.id, verdict: 'fail' }],
    ...settleEvents(ctx, step),
    ...failedStepCardEvents(ctx.log.state, step, Boolean(ctx.phase2.replay)),
  ];
}
