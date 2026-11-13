// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The read tools: `timeline.get` (clips and text in order) and `timeline.findAlternates` (one slot's candidates). */
import {
  callClock,
  defineTool,
  err,
  NO_TOOL_RETRY,
  ok,
  toolCallSummary,
  type AnyTool,
  type Timeline,
} from '@taalcut/core';
import type { z } from 'zod';
import { InvalidMove } from '../errors';
import type { TimelineService } from '../service/service';
import { oneClipId, type ClipNumbering } from './clip-refs';
import {
  alternatesToolInputSchema,
  alternatesToolOutputSchema,
  getToolInputSchema,
  getToolOutputSchema,
} from './schemas';
import { hereView, SHOWS_CHARS } from './editor-view';
import type { ShotDescriptions } from './rerank-material';
import type { TemplateReader } from '../service/templates';
import { slotFactsOf } from './slot-facts';
import { summarizeTimeline } from './summaries';

type TimelineView = z.output<typeof getToolOutputSchema>;

/**
 * EDT1-OPS: each clip's `shows`, what indexing said its shot shows, after the clip's id ("01J…: A dog runs along the
 * beach"), so a request can name a clip by what is in it.
 * Without descriptions, or when they can't be read, the view is unchanged.
 */
async function withShows(
  view: TimelineView,
  describe: ShotDescriptions | undefined,
  docked: boolean,
): Promise<TimelineView> {
  const shotIds = [...new Set(view.clips.flatMap((clip) => (clip.shotId ? [clip.shotId] : [])))];
  if (!describe || shotIds.length === 0) return view;
  const described = await describe(shotIds).catch(() => null);
  if (!described?.ok) return view;
  const cut = (text: string) => (text.length > SHOWS_CHARS ? `${text.slice(0, SHOWS_CHARS - 1).trimEnd()}…` : text);
  return {
    ...view,
    clips: view.clips.map((clip) => {
      const shows = clip.shotId ? described.value.get(clip.shotId)?.trim() : undefined;
      // Right after the id, whether or not the output is parsed again: it says which clip it is about.
      if (!shows) return clip;
      // The agent lifts untrusted text out of the JSON into numbered blocks after it, so the block names its clip:
      // on the 9B, a bare description was read as the next clip's.
      const { clip: number, clipId, ...rest } = clip;
      const head = number === undefined ? {} : { clip: number };
      // EDT1-OPS: in a docked run the block names its clip by number, the handle the editor tools take.
      if (docked && number !== undefined) return { ...head, clipId, shows: `clip ${number}: ${cut(shows)}`, ...rest };
      return { ...head, clipId, shows: `${clipId}: ${cut(shows)}`, ...rest };
    }),
  };
}

/**
 * EDT1-OPS: each clip's number first, as the editor numbers it (gaps not counted): the handle the edit tools take
 * (clip-refs.ts). A docked run's rows then have its id and what it shows, its place in seconds, speed, sound, colour
 * and lock: the slot, asset and shot ids, start and frames, in-point and confidence are left out. They put four more
 * ids between one clip's description and the next, and on the 9B a run copied the neighbour's id.
 */
function numberedRows(view: TimelineView): TimelineView {
  let number = 0;
  return { ...view, clips: view.clips.map((row) => (row.kind === 'clip' ? { clip: ++number, ...row } : row)) };
}

/**
 * AGT2: each slot's row gets what the slot is for, from the template version the timeline names, and the cast's
 * score for its clip (slot-facts.ts). Without a template, or when it can't be read, the rows are unchanged.
 */
async function withSlots(
  view: TimelineView,
  timeline: Timeline,
  templates: TemplateReader | undefined,
): Promise<TimelineView> {
  if (!templates || !timeline.template) return view;
  const template = await templates.read(timeline.template).catch(() => null);
  if (!template?.ok) return view;
  const clipIds = new Map(view.clips.flatMap((row) => (row.slotId ? [[row.slotId, row.clipId] as const] : [])));
  const facts = slotFactsOf(timeline, template.value, clipIds);
  return {
    ...view,
    clips: view.clips.map((row) => {
      const slot = row.slotId ? facts.get(row.slotId) : undefined;
      return slot ? { ...row, slot } : row;
    }),
  };
}

function dockedRows(view: TimelineView): TimelineView {
  return {
    ...view,
    clips: view.clips.map((row) => {
      const { slotId: _slot, assetId: _asset, shotId: _shot, start: _start, frames: _frames, userPick: _pick, sourceStart: _in, confidence: _confidence, ...rest } = row;
      // AGT2: what the slot is for stays; the cast's score, like its confidence, is casting's and left out.
      if (!rest.slot?.cast) return rest;
      const { cast: _cast, ...slot } = rest.slot;
      return { ...rest, slot };
    }),
  };
}

export function readTools(deps: {
  readonly service: TimelineService;
  /** AGT2: the template each timeline was made from, for its rows' slot facts. Absent: rows without them. */
  readonly templates?: TemplateReader;
  readonly shotDescriptions?: ShotDescriptions;
  /** EDT1-OPS: the clips' numbering each read showed, for the edit tools that take a number (clip-refs.ts). */
  readonly numbering?: ClipNumbering;
}): AnyTool[] {
  const get = defineTool({
    name: 'timeline.get',
    // 1.1.0 (AGT2): each clip's slot: the template's intent, needs, face, shot, the reel's timing and the cast's score.
    version: '1.1.0',
    description:
      'Reads a timeline: its clips in order (each one’s number as the editor shows it, its id and what it shows, start and length in seconds, speed, sound, colour, lock; outside the editor’s chat also its slot, shot, frames and confidence), with atSeconds the clip playing then and the cut nearest it (here), the transitions between them, its text items, the sounds on its audio tracks, the music, the whole video’s colour and its markers. A clip made for a template slot has slot: the slot’s number and role, what it should show (intent, needs, face, shot type, camera move, people), where it sits in the reel (at, seconds) and the cast’s score for the clip there with its parts.',
    summary: 'Reads a timeline: its clips, transitions, texts, sounds, music, colour and markers.',
    tags: ['read'],
    input: getToolInputSchema,
    output: getToolOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: { maxAttempts: 2, initialDelayMs: 200 },
    run: async (input, ctx) => {
      const timeline = await deps.service.read(input.timelineId);
      if (!timeline.ok) return timeline;
      // EDT1-OPS: the numbers this run now reads, which a later call's clip numbers count on (clip-refs.ts).
      if (ctx.runId !== undefined) deps.numbering?.read(ctx.runId, timeline.value);
      else deps.numbering?.remember(timeline.value);
      const docked = ctx.editor !== undefined;
      // What each shot shows needs the shot ids, so it goes in before a docked run's rows leave them out.
      const slotted = await withSlots(numberedRows(summarizeTimeline(timeline.value)), timeline.value, deps.templates);
      const shown = await withShows(slotted, deps.shotDescriptions, docked);
      const view = docked ? dockedRows(shown) : shown;
      return ok(input.atSeconds === undefined ? view : { ...view, here: hereView(view.clips, input.atSeconds) });
    },
    summarize: (output) =>
      `Timeline ${output.id} (projectId ${output.projectId ?? 'unknown'}, revision ${output.revision}, ${output.clips.length} clips, ${output.seconds}s).`,
    describeCall: (_input, output) => describeTimelineCall(output),
  });

  const alternates = defineTool({
    name: 'timeline.findAlternates',
    version: '1.0.0',
    description:
      'Finds fresh candidates (other takes) for one clip of a timeline (its number, or "this", or its slotId), scored against the clips either side; shots already used are left out. Swap one in with timeline.swapClip.',
    summary: 'Finds fresh candidates for one slot, given its neighbours.',
    tags: ['casting', 'alternates'],
    input: alternatesToolInputSchema,
    output: alternatesToolOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 30_000,
    retry: NO_TOOL_RETRY,
    run: async (input, ctx) => {
      // EDT1-OPS: the clip by its number or "this", whose slot it is (a docked run's rows have no slot ids).
      let slotId = input.slotId;
      if (input.clip !== undefined) {
        const timeline = await deps.service.read(input.timelineId);
        if (!timeline.ok) return timeline;
        const clipId = await oneClipId(input, {
          timeline: timeline.value,
          editor: ctx.editor,
          revision: input.revision,
          describe: deps.shotDescriptions,
          numbering: deps.numbering,
          runId: ctx.runId,
        });
        if (!clipId.ok) return clipId;
        const row = summarizeTimeline(timeline.value).clips.find((clip) => clip.clipId === clipId.value);
        slotId = row?.slotId ?? undefined;
        if (!slotId) return err(InvalidMove(undefined, { detail: 'That clip has no slot to find other takes for.' }));
      }
      if (!slotId) return err(InvalidMove(undefined, { detail: 'Give the clip: its number (clip), or "this".' }));
      const { clip: _clip, revision: _revision, ...rest } = input;
      const found = await deps.service.findAlternates({ ...rest, slotId });
      return found.ok ? ok({ candidates: found.value }) : found;
    },
  });

  return [get as AnyTool, alternates as AnyTool];
}

/** A timeline's name in a call's summary is cut here: a template's can be a reel's whole title. */
const NAME_CHARS = 60;

/**
 * FIX-TOOLGROUPS: the timeline's name and length, "Goa trip · 0:32", for the call's row in the chat. The name is the
 * person's, or the template's they chose; the model never names a timeline.
 */
function describeTimelineCall(
  output: Pick<z.output<typeof getToolOutputSchema>, 'name' | 'frames' | 'rate'>,
): string | undefined {
  const name = toolCallSummary(output.name);
  const short = name && name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS - 1).trimEnd()}…` : name;
  const length = callClock((output.frames * output.rate.den) / output.rate.num);
  return short ? `${short} · ${length}` : length;
}
