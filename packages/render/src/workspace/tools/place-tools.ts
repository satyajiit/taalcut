// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Putting a design in the video (HFW1 "dsn"): `workspace.place` gates a composition and proposes it on the timeline
 * (`graphics.placeComposition`): it plays in the viewer and is kept only by the person's Use it. `workspace.replace`
 * gives graphics already there a new version of their design (`graphics.setComposition`), each keeping its own
 * words. Both answer with a motion graphic card naming the composition, its poster the newest still rendered of
 * exactly these files.
 */
import {
  editTargetJsonSchema,
  err,
  GRAPHICS_COMMANDS,
  graphicParamValuesSchema,
  newId,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  rationalTimeJsonSchema,
  ulidSchema,
  ValidationError,
  workspacePathSchema,
  motionGraphicCardSchema,
  type Card,
  type GraphicCompositionId,
  type Result,
  type TimelineItemId,
  type GraphicItem,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { z } from 'zod';
import { posterKey, type WorkspaceLooks } from './check-tools';
import { anchorFor, compositionOf, durationOf } from './composition-of';
import type { WorkspaceToolDeps } from './deps';
import { gateEntry } from './gate-run';
import { entryLabel, keyOf, LOCAL, workspaceTool } from './tool-parts';

const projectId = ulidSchema('Project');
const timelineId = ulidSchema('Timeline');
const revision = z.int().positive();
const name = z.string().trim().min(1).max(60).describe('What it is, in a few words ("Chat bubble")');

const placedOutput = z.object({
  projectId,
  timelineId,
  itemIds: z.array(ulidSchema('TimelineItem')).min(1),
  revision,
  compositionId: ulidSchema('GraphicComposition'),
  version: z.int().min(1),
  name: z.string().meta({ untrusted: 'composition-name' }),
  start: rationalTimeJsonSchema,
  duration: rationalTimeJsonSchema,
  unmatched: z.array(z.string()),
  /** A still of these files from their newest workspace.render or renderOver, for the card. */
  posterArtifactId: z.string().optional(),
  note: z.string(),
});
type Placed = z.output<typeof placedOutput>;

/** The graphic on the timeline now. */
function graphicOn(timeline: Timeline, itemId: string): GraphicItem | undefined {
  for (const track of timeline.tracks)
    if (track.kind === 'text')
      for (const item of track.items) if (item.type === 'graphic' && item.id === itemId) return item;
  return undefined;
}

/** Native text starts a design; an existing composition advances the design it already names. */
function replacementDesign(timeline: Timeline, itemId: string, deps: WorkspaceToolDeps) {
  const first = graphicOn(timeline, itemId);
  const native = timeline.tracks.some(
    (track) =>
      track.kind === 'text' && track.items.some((item) => item.type === 'text' && item.id === itemId),
  );
  if (!first && !native)
    return err(
      ValidationError(
        { field: 'itemIds' },
        { detail: 'Not text or a graphic on this timeline: read timeline.get for its itemId' },
      ),
    );
  const id = (first?.composition.id ??
    deps.newCompositionId?.() ??
    newId<'GraphicComposition'>()) as GraphicCompositionId;
  const held = (timeline.graphicCompositions ?? []).filter((copy) => copy.id === id);
  return ok({
    id,
    version: Math.max(0, ...held.map((copy) => copy.version)) + 1,
    name: held.sort((a, b) => b.version - a.version)[0]?.name,
  });
}

/**
 * The graphics already drawn with an earlier version of this entry's design, when the files changed since: the
 * model edited a placed composition, so it is a redesign, which is workspace.replace (eval:design: the 9B placed a
 * second graphic instead, then gave up on the one the job named). Placing the same design again is allowed.
 */
function redesignOf(timeline: Timeline, entry: string, hash: string): string[] {
  const copies = (timeline.graphicCompositions ?? []).filter((copy) => copy.entry === entry);
  if (copies.length === 0 || copies.some((copy) => copy.hash === hash)) return [];
  const edited = new Set(copies.map((copy) => copy.id));
  const ids: string[] = [];
  for (const track of timeline.tracks)
    if (track.kind === 'text')
      for (const item of track.items)
        if (item.type === 'graphic' && item.composition && edited.has(item.composition.id)) ids.push(item.id);
  return ids;
}

/** The card for the first graphic placed: its composition by id and name, its time, its poster. */
function cardOf(done: Placed, runId: string): Result<Card> {
  const parsed = motionGraphicCardSchema.safeParse({
    type: 'motionGraphic',
    id: `graphic:${done.itemIds[0]}`,
    version: done.version,
    runId,
    projectId: done.projectId,
    timelineId: done.timelineId,
    itemId: done.itemIds[0],
    composition: { id: done.compositionId, name: done.name.slice(0, 60) },
    start: done.start,
    duration: done.duration,
    unmatched: done.unmatched.slice(0, 6).map((phrase) => phrase.slice(0, 80)),
    ...(done.posterArtifactId ? { frameArtifactId: done.posterArtifactId } : {}),
  });
  return parsed.success
    ? ok(parsed.data)
    : err(ValidationError({ field: 'card' }, { detail: z.prettifyError(parsed.error) }));
}

/** The placed result, read back from the timeline (its start and length as stored). */
async function placedResult(
  deps: WorkspaceToolDeps,
  base: Omit<Placed, 'start' | 'duration' | 'revision'> & { readonly timelineId: TimelineId },
): Promise<Placed | null> {
  const timeline = await deps.timelines.get(base.timelineId);
  if (!timeline.ok) return null;
  const item = graphicOn(timeline.value, base.itemIds[0] ?? '');
  if (!item) return null;
  return { ...base, revision: timeline.value.revision, start: item.start, duration: item.duration };
}

export function workspacePlaceTools(deps: WorkspaceToolDeps, looks: WorkspaceLooks) {
  const place = workspaceTool({
    name: 'workspace.place',
    description:
      'Puts a composition that passes workspace.lint on the timeline as a proposal: it plays in the viewer and ' +
      'becomes part of the video only when the person chooses Use it. Time it with at (seconds), phrase (words ' +
      'someone says) or target (what the person pointed at); seconds is how long (default: its own length). ' +
      'params sets its variables (its words, colours). request is the job, word for word. replaces: the proposal ' +
      'a Try again replaces. Undoable.',
    summary: 'Proposes a finished composition on the timeline.',
    tags: ['workspace', 'place', 'propose', 'graphic', 'timeline', 'composition'],
    input: z.object({
      projectId,
      timelineId,
      revision,
      entry: workspacePathSchema,
      name,
      request: z.string().trim().min(1).max(500),
      params: graphicParamValuesSchema.optional(),
      at: z.number().min(0).max(3600).optional(),
      phrase: z.string().trim().min(1).max(80).optional(),
      target: editTargetJsonSchema.optional(),
      seconds: z.number().min(0.5).max(600).optional(),
      replaces: ulidSchema('TimelineItem').optional(),
    }),
    output: placedOutput,
    command: GRAPHICS_COMMANDS.placeComposition,
    sideEffect: 'write',
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: keyOf('workspace.place'),
    describeCall: (input, output) => `${entryLabel(input.entry)} · v${output.version}`,
    run: async (input, ctx) => {
      const timeline = await deps.timelines.get(input.timelineId);
      if (!timeline.ok) return timeline;
      if (timeline.value.projectId !== input.projectId)
        return err(NotFoundError({ entity: 'timeline', id: input.timelineId }));
      const anchor = anchorFor(timeline.value, input);
      if (!anchor.ok) return anchor;
      const gated = await gateEntry(deps, input.projectId, input.entry);
      if (!gated.ok) return gated;
      const redesigned = input.replaces ? [] : redesignOf(timeline.value, input.entry, gated.value.hash);
      if (redesigned.length > 0)
        return err(
          ValidationError(
            { field: 'entry' },
            {
              detail:
                `${input.entry} is the design of ${redesigned.join(', ')}, changed since it was placed: to show the ` +
                `change, workspace.replace with itemIds [${redesigned.join(', ')}] and this entry (place adds another ` +
                'graphic). For a new graphic of its own, workspace.new a folder for it.',
            },
          ),
        );
      const sameCopy = (timeline.value.graphicCompositions ?? []).find(
        (copy) => copy.entry === input.entry && copy.hash === gated.value.hash,
      );
      const id = sameCopy?.id ?? deps.newCompositionId?.() ?? newId<'GraphicComposition'>();
      const version = sameCopy?.version ?? 1;
      const composition = await compositionOf(deps, gated.value, {
        id,
        version,
        name: input.name,
        request: input.request,
      });
      if (!composition.ok) return composition;
      const done = await ctx.dispatch({
        projectId: input.projectId,
        timelineId: input.timelineId,
        revision: input.revision,
        composition: composition.value,
        params: input.params ?? {},
        anchor: anchor.value,
        ...(input.seconds !== undefined ? { duration: durationOf(input.seconds) } : {}),
        proposal: { request: input.request, design: 'designed', createdAt: deps.now?.() ?? Date.now() },
        ...(input.replaces ? { replaces: input.replaces } : {}),
      });
      if (!done.ok) return done;
      const receipt = done.value as { itemId: string; unmatched: string[] };
      const poster = looks.posters.get(posterKey(input.projectId, gated.value.hash));
      const result = await placedResult(deps, {
        projectId: input.projectId,
        timelineId: input.timelineId,
        itemIds: [receipt.itemId as TimelineItemId],
        compositionId: id,
        version,
        name: input.name,
        unmatched: receipt.unmatched,
        ...(poster ? { posterArtifactId: poster } : {}),
        note:
          'Proposed: it plays in the viewer and the person chooses Use it to keep it. Say in one line what you ' +
          'made; place it again only with replaces, for a Try again.',
      });
      return result ? ok(result) : err(NotFoundError({ entity: 'graphic', id: receipt.itemId }));
    },
    resultCard: async (done, cardCtx) => cardOf(done, cardCtx.runId),
  });

  const replace = workspaceTool({
    name: 'workspace.replace',
    description:
      'Restyles existing graphics or native text in place: itemIds come from graphics.list or timeline.get texts. ' +
      'Native text becomes a graphic with the same id, timing and words, leaving no old title underneath. ' +
      'For native text declare exactly one text variable; each title’s own words fill it. ' +
      'params are merged over each item’s values. The composition must pass workspace.lint. Undoable.',
    summary: 'Replaces existing text or graphics with a new design without duplicate titles.',
    tags: [
      'workspace',
      'replace',
      'redesign',
      'restyle',
      'graphic',
      'composition',
      'text',
      'native-text',
      'title',
      'duplicate',
      'overlap',
    ],
    input: z.object({
      projectId,
      timelineId,
      revision,
      entry: workspacePathSchema,
      itemIds: z.array(ulidSchema('TimelineItem')).min(1).max(24),
      name: name.optional(),
      params: graphicParamValuesSchema.optional(),
      request: z.string().trim().min(1).max(500).optional(),
    }),
    output: placedOutput,
    command: GRAPHICS_COMMANDS.setComposition,
    sideEffect: 'write',
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: keyOf('workspace.replace'),
    describeCall: (input, output) =>
      `${entryLabel(input.entry)} · v${output.version} · ${input.itemIds.length}`,
    run: async (input, ctx) => {
      const timeline = await deps.timelines.get(input.timelineId);
      if (!timeline.ok) return timeline;
      if (timeline.value.projectId !== input.projectId)
        return err(NotFoundError({ entity: 'timeline', id: input.timelineId }));
      const identity = replacementDesign(timeline.value, input.itemIds[0] ?? '', deps);
      if (!identity.ok) return identity;
      const { id, version, name: heldName } = identity.value;
      const gated = await gateEntry(deps, input.projectId, input.entry);
      if (!gated.ok) return gated;
      const composition = await compositionOf(deps, gated.value, {
        id,
        version,
        name: input.name ?? heldName ?? 'Graphic',
        ...(input.request ? { request: input.request } : {}),
      });
      if (!composition.ok) return composition;
      const done = await ctx.dispatch({
        projectId: input.projectId,
        timelineId: input.timelineId,
        revision: input.revision,
        itemIds: input.itemIds,
        composition: composition.value,
        ...(input.params ? { params: input.params } : {}),
      });
      if (!done.ok) return done;
      const poster = looks.posters.get(posterKey(input.projectId, gated.value.hash));
      const result = await placedResult(deps, {
        projectId: input.projectId,
        timelineId: input.timelineId,
        itemIds: input.itemIds,
        compositionId: id,
        version,
        name: composition.value.name,
        unmatched: [],
        ...(poster ? { posterArtifactId: poster } : {}),
        note: `${input.itemIds.length} graphics drawn with version ${version} of the design. Say in one line what changed.`,
      });
      return result ? ok(result) : err(NotFoundError({ entity: 'graphic', id: input.itemIds[0] }));
    },
    resultCard: async (done, cardCtx) => cardOf(done, cardCtx.runId),
  });

  return { place, replace };
}
