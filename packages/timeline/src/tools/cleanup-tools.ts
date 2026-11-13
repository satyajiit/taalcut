// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V9's agent tools: plan a talking-head cleanup (fillers, pauses over a threshold, retakes, punch-ins on
 * emphasis) and apply the plan in one undo step. The plan is stored as an artifact and applied by its id, so the
 * model never copies hundreds of ranges back.
 */
import {
  artifactRefSchema,
  cleanupPlanSchema,
  cleanupSettingsSchema,
  err,
  NotImplementedError,
  ok,
  TIMELINE_COMMANDS,
  ulidSchema,
  type AnyTool,
} from '@taalcut/core';
import { z } from 'zod';
import type { TimelineService } from '../service/service';
import { appliedPlanInputSchema, applyPlanTool, planTool } from './planned-edit';

const statsSchema = z.object({
  fillers: z.int().nonnegative(),
  pauses: z.int().nonnegative(),
  retakes: z.int().nonnegative(),
  punchIns: z.int().nonnegative(),
  secondsSaved: z.number().nonnegative(),
});

const planInputSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  settings: cleanupSettingsSchema
    .partial()
    .optional()
    .describe(
      'Changes to the app settings for this plan, e.g. pauseThresholdMs (200–2000) or punchIns: false',
    ),
});

const planOutputSchema = z.object({
  revision: z.int().positive(),
  clips: z.int().nonnegative(),
  stats: statsSchema,
  plan: artifactRefSchema,
});

export function cleanupTools(service: TimelineService): AnyTool[] {
  const plan = planTool({
    name: 'timeline.planCleanup',
    description:
      'Plans a talking-head cleanup of a timeline from the speech analysis of its clips: filler words go, pauses longer than the threshold are shortened to a breath, the earlier take of a retake goes, and emphasised words get a gentle punch-in. No word is clipped. Changes nothing; returns how many of each and the seconds saved, with the plan as an artifact to apply with timeline.applyCleanup.',
    summary: 'Plans a talking-head cleanup: fillers, long pauses, retakes, punch-ins. Changes nothing.',
    tags: ['cleanup', 'talking-head', 'fillers', 'pauses', 'read'],
    input: planInputSchema,
    output: planOutputSchema,
    timeoutMs: 20_000,
    make: async (input) => {
      if (!service.planCleanup) return err(NotImplementedError({ feature: 'timelines.planCleanup' }));
      const made = await service.planCleanup(input.timelineId, input.settings);
      if (!made.ok) return made;
      const { revision, clips, stats } = made.value;
      return ok({
        kept: made.value,
        note: `Cleanup plan for ${clips.length} clip(s) at revision ${revision}.`,
        answer: (ref) => ({ revision, clips: clips.length, stats, plan: ref }),
      });
    },
  });

  const apply = applyPlanTool({
    service,
    command: TIMELINE_COMMANDS.applyCleanup,
    description:
      'Applies a cleanup plan from timeline.planCleanup in one undo step: the kept speech laid end to end, later text, captions and markers moved earlier with it. A plan whose clips were edited since is refused (plan again).',
    summary: 'Applies a cleanup plan in one undo step.',
    tags: ['cleanup', 'talking-head'],
    input: appliedPlanInputSchema('timeline.planCleanup'),
    kept: cleanupPlanSchema,
    payload: (input, kept) => ({ projectId: input.projectId, timelineId: input.timelineId, plan: kept.raw }),
  });

  return [plan, apply];
}
