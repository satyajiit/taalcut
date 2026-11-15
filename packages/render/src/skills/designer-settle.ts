// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: the handoff a Designer step is settled with when its model never handed off (its turns ran out) or its
 * handoff never passed the check. What it placed stays in the video, so a job with at least one design in use is
 * a success with fewer options, never a failed job: it is settled as placed (a new graphic) or replaced (the text
 * and graphics it named), with the reason there are fewer than three. A job with nothing placed is `notDone`, and
 * a step that placed nothing at all is not settled (it ends as it did before). Read from the step's completed
 * placing calls and the timeline as it is; the Designer's own check accepts the result or the step fails.
 */
import {
  GRAPHIC_OPTION_COUNT,
  ok,
  type AsyncResult,
  type GraphicItem,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { graphicsIn } from '../compositions/options';
import {
  designerInputSchema,
  type DesignerInput,
  type DesignerJob,
  type DesignerOutput,
} from './designer-checks';

/** One completed call of the step (the agent's `SettlerCall`). */
export interface DesignerStepCall {
  readonly tool: string;
  readonly input: unknown;
  readonly output: unknown;
}

const PLACING = new Set(['workspace.placeOptions', 'workspace.replace']);
export const SETTLED_FEWER = 'The step ended before the other designs were ready.';
export const SETTLED_NONE = 'The step ended before a design was ready.';

type Result = DesignerOutput['results'][number];
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

/** The job's result from what the step placed for it. */
function settledJob(
  job: DesignerJob,
  placing: readonly DesignerStepCall[],
  graphics: ReadonlyMap<string, GraphicItem>,
  onlyNew: boolean,
): Result {
  const none: Result = { jobId: job.jobId, outcome: 'notDone', reason: SETTLED_NONE };
  const inVideo = (id: string) => graphics.has(id) && !graphics.get(id)!.proposal;
  let itemIds: string[];
  if (job.itemIds) {
    const touched = placing.some((call) => {
      const named = [...ids(record(call.input).itemIds), ...ids(record(call.output).itemIds)];
      return named.some((id) => job.itemIds!.includes(id as never));
    });
    if (!touched || !job.itemIds.every(inVideo)) return none;
    itemIds = [...job.itemIds];
  } else {
    // A new graphic's calls name no items (its later designs name the graphic the first one made).
    const fresh = placing.filter(
      (call) => call.tool === 'workspace.placeOptions' && !record(call.input).itemIds,
    );
    const own = fresh.filter((call) => String(record(call.input).request ?? '').trim() === job.request);
    const made = (own.length > 0 || !onlyNew ? own : fresh).flatMap((call) =>
      ids(record(call.output).itemIds),
    );
    itemIds = [...new Set(made)].filter(inVideo);
    if (itemIds.length === 0) return none;
  }
  const fewest = Math.min(...itemIds.map((id) => graphics.get(id)?.options?.designs.length ?? 1));
  return {
    jobId: job.jobId,
    outcome: job.itemIds ? 'replaced' : 'placed',
    itemIds: itemIds as never,
    ...(fewest < GRAPHIC_OPTION_COUNT ? { fewerBecause: SETTLED_FEWER } : {}),
  };
}

/** The settled handoff, or undefined when the step placed nothing for any job. */
export function settledDesigns(
  input: DesignerInput,
  calls: readonly DesignerStepCall[],
  timeline: Timeline,
): DesignerOutput | undefined {
  const graphics = new Map(graphicsIn(timeline.tracks).map((item) => [item.id as string, item]));
  const placing = calls.filter((call) => PLACING.has(call.tool));
  const onlyNew = input.jobs.filter((job) => !job.itemIds).length === 1;
  const results = input.jobs.map((job) => settledJob(job, placing, graphics, onlyNew));
  if (results.every((result) => result.outcome === 'notDone')) return undefined;
  return { timelineId: input.timelineId, revision: timeline.revision, results };
}

/** The agent's settler for `render.designer`: its completed calls, and the step's input (the jobs). */
export function designerSettler(deps: {
  readonly timelines: { get(id: TimelineId): AsyncResult<Timeline> };
}): (
  calls: readonly DesignerStepCall[],
  signal: AbortSignal,
  input?: unknown,
) => AsyncResult<DesignerOutput | undefined> {
  return async (calls, _signal, input) => {
    const parsed = designerInputSchema.safeParse(input);
    if (!parsed.success) return ok(undefined);
    const timeline = await deps.timelines.get(parsed.data.timelineId);
    if (!timeline.ok) return timeline;
    return ok(settledDesigns(parsed.data, calls, timeline.value));
  };
}
