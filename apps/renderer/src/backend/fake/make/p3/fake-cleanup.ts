// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- core errors' `detail`: for developers, never UI copy */

/**
 * P3-V9: a talking head's cleanup plan (timelines.planCleanup) and timeline.applyCleanup, as the real ones
 * answer. The plan reads the speech analysis of each talking clip's asset (the talking-head seed registers
 * them; any other footage has none: timeline.cleanup_no_speech). Apply checks the plan against the timeline: a
 * plan made on another revision is timeline.cleanup_stale unless its clips' fingerprint still matches (an
 * unrelated edit since) or it is the redo of this very command; one undo step puts everything back.
 */
import {
  appContract,
  defineCommand,
  err,
  implementContract,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  toRpcError,
  ValidationError,
  type AnyCommand,
} from '@taalcut/core';
import { timelineError } from '../edits';
import { applyCleanupPlan, staleError } from './cleanup/apply';
import { clipsFingerprint, planCleanup } from './cleanup/plan';
import type { MakeP3Deps } from './deps';

const PROCEDURES = { planCleanup: appContract.timelines.planCleanup };

export function createFakeCleanup(deps: MakeP3Deps) {
  const os = implementContract(PROCEDURES);
  const router = {
    planCleanup: os.planCleanup.handler(async ({ input }) => {
      const timeline = deps.timelines.get(input.timelineId);
      if (!timeline) throw toRpcError(timelineError('timeline.not_found', { timelineId: input.timelineId }));
      const plan = await planCleanup(timeline, input.settings, deps.ids.item);
      if (!plan.ok) throw toRpcError(plan.error);
      return plan.value;
    }),
  };

  const applyCleanup = defineCommand({
    name: TIMELINE_COMMANDS.applyCleanup,
    payload: timelineCommandPayloads[TIMELINE_COMMANDS.applyCleanup],
    sideEffect: 'write',
    project: (p) => p.projectId,
    handle: async (p, context) => {
      if (p.plan.timelineId !== p.timelineId)
        return err(ValidationError({ field: 'plan' }, { detail: 'The plan is for another timeline' }));
      const before = deps.timelines.get(p.timelineId);
      if (!before) return err(timelineError('timeline.not_found', { timelineId: p.timelineId }));
      if (p.plan.revision !== before.revision && context.replay !== 'redo') {
        const named = new Set<string>(p.plan.clips.map((clip) => clip.clipId));
        const same =
          p.plan.clipsFingerprint !== undefined &&
          (await clipsFingerprint(before, named)) === p.plan.clipsFingerprint;
        if (!same) return err(staleError(p.plan.revision));
      }
      return deps.timelines.write(p.projectId, before, applyCleanupPlan(before, p.plan, context.source));
    },
  });

  const commands: AnyCommand[] = [applyCleanup];
  return { router, commands };
}
