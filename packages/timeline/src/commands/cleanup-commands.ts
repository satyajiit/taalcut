// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.applyCleanup (P3-V9): a plan from timelines.planCleanup, applied in one undo step. A plan made on
 * another revision applies while the clips it names are as they were (its `clipsFingerprint`, round P3-3), so
 * an unrelated edit in between doesn't refuse it; otherwise it is timeline.cleanup_stale. A plan stored
 * without a fingerprint keeps the revision rule. A redo (`context.replay`, also after a restart) is never
 * stale: undo put back the document the plan was made on (any other edit since would have cleared the redo),
 * only at a newer revision.
 */
import {
  defineCommand,
  err,
  newId,
  TIMELINE_COMMANDS,
  timelineCommandPayloads as payloads,
  ValidationError,
  type CleanupPlan,
  type Timeline,
} from '@taalcut/core';
import { applyCleanup } from '../cleanup/apply-cleanup';
import { clipsFingerprint } from '../cleanup/clips-fingerprint';
import { CleanupStale } from '../errors';
import { writeEdit, type CommandDeps } from './context';

/** Whether the plan still fits the timeline: made on this revision, or its planned clips are unchanged. */
function planFits(plan: CleanupPlan, timeline: Timeline): boolean {
  if (plan.revision === timeline.revision) return true;
  if (plan.clipsFingerprint === undefined) return false;
  return clipsFingerprint(timeline, plan.clips.map((planned) => planned.clipId)) === plan.clipsFingerprint;
}

export function createCleanupCommands(deps: CommandDeps) {
  const ids = deps.ids ?? (() => newId<'TimelineItem'>());
  const apply = defineCommand({
    name: TIMELINE_COMMANDS.applyCleanup,
    payload: payloads[TIMELINE_COMMANDS.applyCleanup],
    sideEffect: 'write',
    handle: async (payload, context) => {
      if (payload.plan.timelineId !== payload.timelineId)
        return err(ValidationError({ field: 'plan' }, { detail: 'The plan is for another timeline' }));
      const redo = context.replay === 'redo';
      return writeEdit(deps, payload, context, (timeline) => {
        if (!redo && !planFits(payload.plan, timeline))
          return err(CleanupStale({ revision: payload.plan.revision }));
        return applyCleanup(timeline, payload.plan, { source: context.source, ids });
      });
    },
  });
  return { apply, all: [apply] };
}
