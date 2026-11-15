// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Designer's input, its handoff and its check (HFW1 "dsn"). The input is the jobs the Editor recorded with
 * `graphics.design` (or that template reading and a make hand it), on one timeline. The check is deterministic and
 * reads the timeline: every job ends as graphics the timeline really holds, in the video (not waiting as a
 * proposal), or with a stated reason. DSG2: a job's graphics carry three designs to choose between, placed one
 * at a time (`workspace.placeOptions`), or the result says why there are fewer (`fewerBecause`: a change the
 * person asked of the design in use, a design the gate kept refusing). The check sends a job with fewer and no
 * reason back; it never takes a placed design away, and a step that ends early is settled from what it placed
 * (designer-settle.ts). Nothing is left silently undone, and no kit design hides a miss.
 */
import { z } from 'zod';
import {
  DESIGN_JOB_MAX_ITEMS,
  editTargetJsonSchema,
  GRAPHIC_OPTION_COUNT,
  GRAPHIC_REQUEST_MAX,
  ulidSchema,
  type GraphicItem,
  type SkillVerdict,
  type Timeline,
} from '@taalcut/core';

/** The most jobs one Designer step takes. */
export const DESIGNER_JOBS_MAX = 8;

/** One job, as `graphics.design` recorded it (core's graphicsDesignJobSchema) with its id. */
export const designerJobSchema = z.object({
  jobId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  request: z.string().trim().min(1).max(GRAPHIC_REQUEST_MAX).meta({ untrusted: 'user-request' }),
  itemIds: z.array(ulidSchema('TimelineItem')).min(1).max(DESIGN_JOB_MAX_ITEMS).optional(),
  at: z.number().min(0).max(3600).optional(),
  phrase: z.string().trim().min(1).max(80).optional(),
  target: editTargetJsonSchema.optional(),
  commentId: ulidSchema('TimelineComment').optional(),
});
export type DesignerJob = z.output<typeof designerJobSchema>;

export const designerInputSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  templateId: ulidSchema('Template').optional(),
  jobs: z.array(designerJobSchema).min(1).max(DESIGNER_JOBS_MAX),
});
export type DesignerInput = z.output<typeof designerInputSchema>;

export const DESIGN_OUTCOMES = ['placed', 'replaced', 'notDone'] as const;

export const designerOutputSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive().describe('The timeline revision after your last change'),
  results: z
    .array(
      z.object({
        jobId: z.string(),
        outcome: z.enum(DESIGN_OUTCOMES),
        itemIds: z.array(ulidSchema('TimelineItem')).max(DESIGN_JOB_MAX_ITEMS).optional(),
        compositionId: ulidSchema('GraphicComposition').optional(),
        reason: z.string().trim().min(1).max(300).optional().describe('notDone: why, in one line'),
        fewerBecause: z
          .string()
          .trim()
          .min(1)
          .max(300)
          .optional()
          .describe(`fewer than ${GRAPHIC_OPTION_COUNT} designs: why`),
      }),
    )
    .min(1)
    .max(DESIGNER_JOBS_MAX),
});
export type DesignerOutput = z.output<typeof designerOutputSchema>;

const retry = (reason: string): SkillVerdict => ({ verdict: 'retry', reason });

function graphicsOf(timeline: Timeline): Map<string, GraphicItem> {
  const found = new Map<string, GraphicItem>();
  for (const track of timeline.tracks)
    if (track.kind === 'text') for (const item of track.items) if (item.type === 'graphic') found.set(item.id, item);
  return found;
}

/** What is wrong with one job's result on the timeline as it is, or null. */
function resultProblem(
  job: DesignerJob,
  result: DesignerOutput['results'][number],
  graphics: ReadonlyMap<string, GraphicItem>,
): string | null {
  if (result.outcome === 'notDone') return result.reason ? null : `job ${job.jobId} is notDone: say why in reason`;
  // eval:design: the 9B placed a second graphic for a redesign, then gave up on the one it was to change.
  if (result.outcome === 'placed' && (job.itemIds?.length ?? 0) > 0)
    return `job ${job.jobId} redesigns ${job.itemIds!.join(', ')}: workspace.placeOptions with those itemIds redraws them in place (without itemIds it adds another graphic), and say replaced`;
  const ids = result.itemIds ?? [];
  if (ids.length === 0) return `job ${job.jobId} is ${result.outcome}: give the itemIds of its graphics`;
  for (const id of ids) {
    const item = graphics.get(id);
    if (!item?.composition) return `job ${job.jobId}: ${id} is not a designed graphic on the timeline`;
    if (result.compositionId && item.composition.id !== result.compositionId)
      return `job ${job.jobId}: ${id} is drawn with another composition than ${result.compositionId}`;
  }
  // DSG2: nothing waits on the person as a proposal; the first design is in the video.
  const waiting = ids.find((id) => graphics.get(id)?.proposal);
  if (waiting)
    return `job ${job.jobId}: ${waiting} is still a proposal: place the job's designs with workspace.placeOptions, which puts the first in the video`;
  if (result.outcome === 'replaced') {
    const left = (job.itemIds ?? []).filter((id) => !ids.includes(id));
    if (left.length > 0) return `job ${job.jobId} names ${left.join(', ')}: redesign them too, or say why not`;
  }
  // DSG2: three designs to choose between, or the stated reason there are fewer.
  const fewest = Math.min(...ids.map((id) => graphics.get(id)?.options?.designs.length ?? 1));
  if (fewest < GRAPHIC_OPTION_COUNT && !result.fewerBecause)
    return `job ${job.jobId} ended with ${fewest} of ${GRAPHIC_OPTION_COUNT} designs: design the next in its own folder and place it with workspace.placeOptions (the same request and itemIds), or say in fewerBecause why there are fewer`;
  return null;
}

/**
 * The check: one result per job, each on the timeline with its three designs or with its reason, at the timeline's
 * revision.
 */
export function checkDesigns(output: DesignerOutput, input: DesignerInput | undefined, timeline: Timeline): SkillVerdict {
  if (timeline.revision !== output.revision)
    return retry(`The timeline is at revision ${timeline.revision}; hand off that.`);
  const graphics = graphicsOf(timeline);
  const jobs = input?.jobs ?? [];
  const missing = jobs.filter((job) => !output.results.some((result) => result.jobId === job.jobId));
  if (missing.length > 0)
    return retry(
      `No result for job ${missing.map((job) => job.jobId).join(', ')}: design it and place it, or say notDone with the reason.`,
    );
  const problems = jobs.flatMap((job) => {
    const result = output.results.find((entry) => entry.jobId === job.jobId);
    const problem = result ? resultProblem(job, result, graphics) : null;
    return problem ? [problem] : [];
  });
  return problems.length > 0 ? retry(`${problems.slice(0, 3).join('; ')}.`) : { verdict: 'pass' };
}
