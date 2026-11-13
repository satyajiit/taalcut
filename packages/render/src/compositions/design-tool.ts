// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Editor's `graphics.design` (HFW1 "dsn"): every new graphic and every change to a graphic's look is a job for
 * the Designer. The call records the job (the person's words verbatim, the graphics it is about or where a new one
 * comes on, and the comment it answers) after checking it names what the timeline holds; the agent's flow-followups
 * read the step's completed calls and add the Designer's step after the Editor's, and a comment handed over is the
 * Designer's to answer. Nothing changes until then, so the call is a read.
 */
import {
  callClock,
  err,
  GRAPHICS_DESIGN_TOOL,
  graphicsDesignJobSchema,
  NotFoundError,
  ok,
  resolveEditTarget,
  ulidSchema,
  ValidationError,
  type ToolSpec,
} from '@taalcut/core';
import { z } from 'zod';
import type { TimelineAccess } from '../ports';

const job = graphicsDesignJobSchema.shape;

export const designToolInputSchema = z
  .object({ projectId: ulidSchema('Project'), timelineId: ulidSchema('Timeline'), ...job })
  .refine(
    (input) =>
      [input.at, input.phrase, input.target?.kind === 'timeline' ? undefined : input.target].filter(
        (where) => where !== undefined,
      ).length <= 1,
    {
      message: 'Say where with one of at, phrase or target',
      path: ['at'],
    },
  );

export const designToolOutputSchema = z.object({
  /** The job's id in the Designer's step. */
  jobId: z.string(),
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  request: z.string().meta({ untrusted: 'user-request' }),
  itemIds: job.itemIds,
  at: job.at,
  phrase: job.phrase,
  target: job.target,
  commentId: job.commentId,
  note: z.string(),
});
export type DesignToolOutput = z.output<typeof designToolOutputSchema>;

const NOTE =
  'Recorded. The Designer designs it after your step, places it as a proposal and answers the comment if there is ' +
  'one. Do not change the graphic yourself; say in one line that its design is on the way.';

export interface DesignToolDeps {
  readonly timelines: TimelineAccess;
  /**
   * A job was recorded in this run: it is the run's change, so the Editor's check doesn't send a docked run back for
   * changing nothing (the desktop spends the Editor's once-a-run ask, timeline's ClipNumbering `firstAsk`).
   */
  readonly recorded?: (runId: string) => void;
}

export function createDesignTool(deps: DesignToolDeps) {
  const tool: ToolSpec<typeof designToolInputSchema, typeof designToolOutputSchema> = {
    name: GRAPHICS_DESIGN_TOOL,
    version: '1.0.0',
    description:
      'Asks the Designer for a graphic: any NEW graphic (a title, a lower third, chat messages, a map pin, a ' +
      'countdown, a sticker, a chart) and any change to how one LOOKS ("bubbles like the reel’s", "more pop", ' +
      '"bluer", a comment on a graphic). request is the person’s words, word for word. A change ' +
      'to graphics or native text already there names them in itemIds (graphics.list or timeline.get texts); ' +
      'restyling native text replaces it in place without duplicate titles. A new one says when with at (seconds), ' +
      'phrase (words someone says) or target (what is selected). commentId: the comment it answers, which the ' +
      'Designer then replies to. Moving or resizing a graphic is also graphics.design; retiming or rewording ' +
      'a graphic is graphics.edit. Moving native text without restyling is timeline.moveText.',
    summary: 'Asks the Designer for a new graphic or a new look for one, from the person’s words.',
    tags: [
      'graphics',
      'graphic',
      'design',
      'create',
      'add',
      'new',
      'look',
      'restyle',
      'style',
      'redesign',
      'title',
      'text',
      'native-text',
      'replace',
      'alignment',
      'lower-third',
      'message',
      'bubble',
      'sticker',
      'callout',
      'countdown',
      'chart',
    ],
    input: designToolInputSchema,
    output: designToolOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: { maxAttempts: 2, initialDelayMs: 300 },
    permission: { network: 'none' },
    describeCall: (input) =>
      input.itemIds ? `${input.itemIds.length}` : input.at !== undefined ? callClock(input.at) : undefined,
    run: async (input, ctx) => {
      const timeline = await deps.timelines.get(input.timelineId);
      if (!timeline.ok) return timeline;
      if (timeline.value.projectId !== input.projectId)
        return err(NotFoundError({ entity: 'timeline', id: input.timelineId }));
      const graphics = new Set(
        timeline.value.tracks.flatMap((track) =>
          track.kind === 'text' ? track.items.map((item) => item.id) : [],
        ),
      );
      const missing = input.itemIds?.find((id) => !graphics.has(id));
      if (missing)
        return err(
          NotFoundError(
            { entity: 'textOrGraphic', id: missing },
            { detail: `${missing} is not text or a graphic on this timeline: timeline.get names them` },
          ),
        );
      if (input.target && !resolveEditTarget(input.target, timeline.value))
        return err(ValidationError({ field: 'target' }, { detail: 'The target is not on this timeline' }));
      const { projectId, timelineId, request, target, ...where } = input;
      const keepTarget =
        target && !(target.kind === 'timeline' && (where.at !== undefined || where.phrase !== undefined))
          ? { target }
          : {};
      if (ctx.runId) deps.recorded?.(ctx.runId);
      return ok({ jobId: ctx.callId, projectId, timelineId, request, ...where, ...keepTarget, note: NOTE });
    },
  };
  return tool;
}
