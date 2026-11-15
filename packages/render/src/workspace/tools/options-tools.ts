// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Putting a job's designs in the video (DSG2): `workspace.placeOptions` gates a design (or up to three) and places
 * it (`graphics.placeOptions`). The first one placed for a job is in the video at once, as a new graphic or in place
 * of the text and graphics the job names, and starts the graphic's set; each later one joins that set as another
 * option the person chooses from, so a step that ends early leaves what it placed and never a plain graphic. A
 * later call is the same job's when the run started the set and the request is the same; anything else starts
 * over (a "try again" replaces the set). The tool holds a set to what the Designer was asked for: each design in
 * its own folder with its own idea (options-differ.ts), the same words in each, each looked at over the footage
 * first, and a placed design never placed again. Each option keeps a still with the workspace's files, so the
 * person sees it over their own video: the Designer's own render when it is small enough to be a workspace file,
 * else one drawn here at a tile's size where the graphic plays (option-stills.ts). It answers with the motion
 * graphic card and its options.
 */
import {
  editTargetJsonSchema,
  err,
  GRAPHIC_OPTION_COUNT,
  GRAPHIC_OPTION_IDEA_MAX,
  GRAPHICS_COMMANDS,
  graphicParamValuesSchema,
  motionGraphicCardSchema,
  newId,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  rationalTimeJsonSchema,
  ulidSchema,
  ValidationError,
  WORKSPACE_LIMITS,
  type AsyncResult,
  type Card,
  type GraphicComposition,
  type GraphicItem,
  type GraphicOptions,
  type GraphicOptionStill,
  type ProjectId,
  type Result,
  type Timeline,
} from '@taalcut/core';
import { z } from 'zod';
import { graphicsIn, newestCopy } from '../../compositions/options';
import { posterKey, type WorkspaceLooks } from './check-tools';
import { anchorFor, compositionOf, durationOf } from './composition-of';
import type { WorkspaceToolDeps } from './deps';
import { gateEntry, refusalText, type GatedEntry } from './gate-run';
import { optionStill, stillPlace } from './option-stills';
import { jobSet, secondsOf } from './options-job';
import { sameDesignProblem } from './options-differ';
import { entryLabel, keyOf, LOCAL, workspaceTool } from './tool-parts';
import { textOf } from './workspace-io';

const projectId = ulidSchema('Project');
const timelineId = ulidSchema('Timeline');

/**
 * One option as the Designer names it. The schema is sent to the model beside the Designer's prompt in a window as
 * small as 12k tokens, so it is kept lean: `entry` is a workspace path that `gateEntry` refuses when it is not one
 * (its pattern is not repeated here), and what the fields are for is in the tool's description.
 */
const optionInput = z.object({
  entry: z.string().trim().min(1).max(WORKSPACE_LIMITS.pathLength),
  name: z.string().trim().min(1).max(60),
  idea: z.string().trim().min(1).max(GRAPHIC_OPTION_IDEA_MAX).describe('Its point of view, in one line'),
});

const placedOption = z.object({
  compositionId: ulidSchema('GraphicComposition'),
  version: z.int().min(1),
  name: z.string().meta({ untrusted: 'composition-name' }),
  idea: z.string().meta({ untrusted: 'composition-name' }),
  posterArtifactId: z.string().optional(),
});

const output = z.object({
  projectId,
  timelineId,
  itemIds: z.array(ulidSchema('TimelineItem')).min(1),
  revision: z.int().positive(),
  /** The design in use. */
  compositionId: ulidSchema('GraphicComposition'),
  options: z.array(placedOption).min(1).max(GRAPHIC_OPTION_COUNT),
  start: rationalTimeJsonSchema,
  duration: rationalTimeJsonSchema,
  unmatched: z.array(z.string()),
  note: z.string(),
});
type Placed = z.output<typeof output>;

const refuse = (field: string, detail: string) => err(ValidationError({ field }, { detail }));

const graphicOn = (timeline: Timeline, itemId: string): GraphicItem | undefined =>
  graphicsIn(timeline.tracks).find((item) => item.id === itemId);

/** The card for the set: the graphic, the design in use, and every option with its still. */
function cardOf(done: Placed, runId: string): Result<Card> {
  const inUse =
    done.options.find((option) => option.compositionId === done.compositionId) ?? done.options[0]!;
  const parsed = motionGraphicCardSchema.safeParse({
    type: 'motionGraphic',
    id: `graphic:${done.itemIds[0]}`,
    version: inUse.version,
    runId,
    projectId: done.projectId,
    timelineId: done.timelineId,
    itemId: done.itemIds[0],
    composition: { id: inUse.compositionId, name: inUse.name.slice(0, 60) },
    start: done.start,
    duration: done.duration,
    unmatched: done.unmatched.slice(0, 6).map((phrase) => phrase.slice(0, 80)),
    ...(inUse.posterArtifactId ? { frameArtifactId: inUse.posterArtifactId } : {}),
    ...(done.options.length > 1
      ? {
          options: done.options.map((option) => ({
            compositionId: option.compositionId,
            name: option.name.slice(0, 60),
            idea: option.idea,
            ...(option.posterArtifactId ? { frameArtifactId: option.posterArtifactId } : {}),
          })),
        }
      : {}),
  });
  return parsed.success
    ? ok(parsed.data)
    : err(ValidationError({ field: 'card' }, { detail: z.prettifyError(parsed.error) }));
}

export function workspaceOptionsTool(deps: WorkspaceToolDeps, looks: WorkspaceLooks) {
  /** Each entry gated, or the first refusal naming it. */
  async function gatedOptions(project: ProjectId, entries: readonly string[]): AsyncResult<GatedEntry[]> {
    const gated: GatedEntry[] = [];
    for (const entry of entries) {
      const one = await gateEntry(deps, project, entry);
      if (!one.ok) return one;
      if (!one.value.result.gate.passed || one.value.result.durationSeconds === undefined)
        return refuse('options', `${entry}: ${refusalText(one.value.result)}`);
      gated.push(one.value);
    }
    return ok(gated);
  }

  /** The designs a set already holds, each with its entry file as it was placed. */
  async function placedDesigns(project: ProjectId, timeline: Timeline, set: GraphicOptions) {
    const placed: { entry: string; hash: string; html: string }[] = [];
    for (const design of set.designs) {
      const copy = newestCopy(design.compositionId, timeline.graphicCompositions);
      const file = copy?.files.find((entry) => entry.path === copy.entry);
      const html = file ? await textOf(deps.store, project, file) : undefined;
      if (copy) placed.push({ entry: copy.entry, hash: copy.hash, html: html?.ok ? html.value : '' });
    }
    return placed;
  }

  return workspaceTool({
    name: 'workspace.placeOptions',
    description:
      'Places a finished design of a job in the video. The first placed for a job is in the video at once; each ' +
      'later one (the same request, the itemIds the first returned) joins it as another option the person ' +
      'chooses from, up to three. Each has its own folder, passes lint (the tool draws it where it plays), has ' +
      'the same text variables, and is unlike the others in two of type, layout and motion (not colour). New graphic: at ' +
      '(seconds), phrase or target; seconds is its length; params its words. Existing text or graphics: itemIds, ' +
      'redrawn in place with their own words and time. request is the job, word for word. Undoable.',
    summary: 'Places a design for a job: the first in the video, later ones as options to choose from.',
    tags: [
      'workspace',
      'place',
      'options',
      'choose',
      'designs',
      'graphic',
      'timeline',
      'composition',
      'redesign',
    ],
    input: z.object({
      projectId,
      timelineId,
      // No revision: the tool reads the timeline and places on it as it is. A 9B sent the workspace's revision for
      // the timeline's every time and lost a turn of its thirty to each refusal.
      options: z.array(optionInput).min(1).max(GRAPHIC_OPTION_COUNT),
      request: z.string().trim().min(1).max(500),
      itemIds: z.array(ulidSchema('TimelineItem')).min(1).max(24).optional(),
      params: graphicParamValuesSchema.optional(),
      at: z.number().min(0).max(3600).optional(),
      phrase: z.string().trim().min(1).max(80).optional(),
      target: editTargetJsonSchema.optional(),
      seconds: z.number().min(0.5).max(600).optional(),
    }),
    output,
    command: GRAPHICS_COMMANDS.placeOptions,
    sideEffect: 'write',
    // Up to three tile stills may be drawn here, one capture each.
    timeoutMs: 180_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: keyOf('workspace.placeOptions'),
    describeCall: (input) => `${entryLabel(input.options[0]?.entry ?? '')} · ${input.options.length}`,
    run: async (input, ctx) => {
      const timeline = await deps.timelines.get(input.timelineId);
      if (!timeline.ok) return timeline;
      if (timeline.value.projectId !== input.projectId)
        return err(NotFoundError({ entity: 'timeline', id: input.timelineId }));
      const entries = input.options.map((option) => option.entry);
      if (new Set(entries).size !== entries.length)
        return refuse('options', 'Each option is a composition of its own: give each its own folder');
      const ideas = input.options.map((option) => option.idea.toLowerCase());
      if (new Set(ideas).size !== ideas.length)
        return refuse('options', 'Two options state the same idea: say what each one goes for');
      const anchor = input.itemIds ? undefined : anchorFor(timeline.value, input);
      if (anchor && !anchor.ok) return anchor;
      const run = ctx.runId ?? 'none';
      const where = stillPlace(timeline.value, {
        anchor: anchor?.value,
        itemIds: input.itemIds,
        params: input.params,
        seconds: input.seconds,
      });
      const gated = await gatedOptions(input.projectId, entries);
      if (!gated.ok) return gated;
      // The same job's later design joins the set its first one started; anything else starts one.
      let joining = jobSet(
        timeline.value,
        { request: input.request, itemIds: input.itemIds, start: where.start },
        looks.sets?.get(run),
      );
      const before = joining ? await placedDesigns(input.projectId, timeline.value, joining.set) : [];
      const again = gated.value.filter((entry) => before.some((placed) => placed.entry === entry.entry.path));
      if (joining && again.length > 0) {
        // The job's own designs at another moment are one more graphic with the same look, sharing the set.
        const asPlaced = gated.value.every((entry) =>
          before.some((placed) => placed.entry === entry.entry.path && placed.hash === entry.hash),
        );
        const elsewhere =
          !input.itemIds && joining.graphics.every((item) => Math.abs(secondsOf(item) - where.start) > 0.02);
        if (!asPlaced || !elsewhere)
          return refuse(
            'options',
            `${again[0]!.entry.path} is in the video already as one of this job's designs. A placed design is ` +
              'not rewritten or placed again: give the next design its own folder',
          );
        joining = undefined;
      }
      if (joining) {
        const room = GRAPHIC_OPTION_COUNT - joining.set.designs.length;
        if (room === 0)
          return refuse(
            'options',
            `This job has its ${GRAPHIC_OPTION_COUNT} designs in the video already: hand off`,
          );
        if (entries.length > room)
          return refuse('options', `This job has room for ${room} more of ${GRAPHIC_OPTION_COUNT} designs`);
      }
      const alike = sameDesignProblem([
        ...(joining ? before : []),
        ...gated.value.map((entry) => ({ entry: entry.entry.path, html: entry.text })),
      ]);
      if (alike) return refuse('options', alike);

      // Each design is drawn before it is in the video: by the Designer (workspace.renderOver, its poster) or,
      // when it did not, by this tool, whose still for the person is drawn where the graphic plays. A weak model
      // lost its turns to the render tool's inputs and to redrawing a design that had passed.
      const posters = gated.value.map((entry) => looks.posters.get(posterKey(input.projectId, entry.hash)));
      const canDraw = deps.frames !== undefined;

      // Where the graphic plays and the words it shows there: what each design's still is drawn over and with.
      const place = joining
        ? stillPlace(timeline.value, { itemIds: joining.graphics.map((item) => item.id) })
        : where;
      const designs: { composition: GraphicComposition; idea: string; still?: GraphicOptionStill }[] = [];
      const drawn = new Map<string, string>();
      for (const [at, entry] of gated.value.entries()) {
        const held = (timeline.value.graphicCompositions ?? []).find(
          (copy) => copy.entry === entry.entry.path && copy.hash === entry.hash,
        );
        const composition = await compositionOf(deps, entry, {
          id: held?.id ?? deps.newCompositionId?.() ?? newId<'GraphicComposition'>(),
          version: held?.version ?? 1,
          name: input.options[at]!.name,
          request: input.request,
        });
        if (!composition.ok) return composition;
        const still = await optionStill(deps, ctx, {
          projectId: input.projectId,
          timeline: timeline.value,
          entry,
          composition: composition.value,
          poster: posters[at],
          place,
        });
        if (canDraw && !posters[at] && !still)
          return refuse(
            'options',
            `${entry.entry.path} could not be drawn where it plays: workspace.renderOver it to see why, fix it, ` +
              'then place it',
          );
        if (posters[at]) drawn.set(composition.value.id, posters[at]);
        designs.push({
          composition: composition.value,
          idea: input.options[at]!.idea,
          ...(still ? { still } : {}),
        });
      }

      const done = await ctx.dispatch({
        projectId: input.projectId,
        timelineId: input.timelineId,
        revision: timeline.value.revision,
        designs,
        request: input.request,
        createdAt: deps.now?.() ?? Date.now(),
        ...(joining
          ? { itemIds: joining.graphics.map((item) => item.id), join: true }
          : input.itemIds
            ? { itemIds: input.itemIds }
            : {
                anchor: anchor!.value,
                params: input.params ?? {},
                ...(input.seconds !== undefined ? { duration: durationOf(input.seconds) } : {}),
              }),
      });
      if (!done.ok) return done;
      const receipt = done.value as { itemIds: string[]; set: string; unmatched: string[] };
      looks.sets?.set(run, new Set([...(looks.sets.get(run) ?? []), receipt.set]));
      const after = await deps.timelines.get(input.timelineId);
      const item = after.ok ? graphicOn(after.value, receipt.itemIds[0] ?? '') : undefined;
      if (!after.ok || !item?.options)
        return err(NotFoundError({ entity: 'graphic', id: receipt.itemIds[0] ?? '' }));
      const options = item.options.designs.flatMap((design) => {
        const copy = newestCopy(design.compositionId, after.value.graphicCompositions);
        const poster = drawn.get(design.compositionId);
        return copy
          ? [
              {
                compositionId: copy.id,
                version: copy.version,
                name: copy.name,
                idea: design.idea,
                ...(poster ? { posterArtifactId: poster } : {}),
              },
            ]
          : [];
      });
      const left = GRAPHIC_OPTION_COUNT - options.length;
      return ok({
        projectId: input.projectId,
        timelineId: input.timelineId,
        itemIds: receipt.itemIds,
        revision: after.value.revision,
        compositionId: item.composition.id,
        options,
        start: item.start,
        duration: item.duration,
        unmatched: receipt.unmatched,
        note:
          left > 0
            ? `In the video now: ${options.length} of ${GRAPHIC_OPTION_COUNT} designs, option 1 in use. The next ` +
              'design goes in its own folder; place it with the same request and these itemIds. Never rewrite ' +
              'a placed design.'
            : `All ${GRAPHIC_OPTION_COUNT} designs are in the video and the person chooses between them: hand off.`,
      });
    },
    resultCard: async (done, cardCtx) => cardOf(done, cardCtx.runId),
  });
}
