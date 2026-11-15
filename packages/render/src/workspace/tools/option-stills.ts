// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: the still a design option keeps for the person's picker. It lives with the workspace's files (the app reads
 * it by its sha256), so it is no larger than a workspace file. The Designer's own render of the option is used when
 * it is that small; a still at the size the model looks at usually is not, so one is drawn here at a tile's size:
 * the option at the middle of its length, with the words the graphic shows, over the video where it plays (with the
 * text or graphics it replaces left out). These draws are for the person, not the model: they are not returned to
 * it, are not sent anywhere, and do not count against the run's renders. Without a stills worker, or when a still
 * cannot be drawn or kept, the option has none and the picker shows the shot under the graphic.
 */
import {
  compositionFor,
  GRAPHIC_OPTION_STILL_BYTES,
  workspaceImageType,
  type ArtifactId,
  type GraphicAnchor,
  type GraphicComposition,
  type GraphicOptionStill,
  type GraphicParamValues,
  type ProjectId,
  type RationalTime,
  type Timeline,
  type TimelineItemId,
  type ToolContextBase,
  type WorkspaceFramesInput,
} from '@taalcut/core';
import { carriedParams, newestCopy, textTrackItems, wordNames } from '../../compositions/options';
import { resolveTiming } from '../../compositions/timing';
import { timingContextOf } from '../../compositions/timing-context';
import type { WorkspaceToolDeps } from './deps';
import type { GatedEntry } from './gate-run';

/** A tile still's longer side in pixels: the larger first, the smaller when that one is too large to keep. */
export const TILE_STILL_SIDES = [384, 256] as const;

/** Where a job's graphic plays, and the first text or graphic it redesigns (its words are the still's). */
export interface StillPlace {
  /** Seconds from the video's start. */
  readonly start: number;
  readonly leaveOut: readonly TimelineItemId[];
  /** The values a new graphic was given. */
  readonly params: GraphicParamValues;
  /** The text or graphic redesigned, when the job names some: its own words go in the still. */
  readonly first?: ReturnType<typeof textTrackItems>[number];
}

const secondsOf = (time: RationalTime) => (time.value * time.rate.den) / time.rate.num;

/** Where the stills are drawn: the named item's start, or the new graphic's anchor resolved as placing resolves it. */
export function stillPlace(
  timeline: Timeline,
  job: {
    readonly anchor?: GraphicAnchor | undefined;
    readonly itemIds?: readonly string[] | undefined;
    readonly params?: GraphicParamValues | undefined;
    readonly seconds?: number | undefined;
  },
): StillPlace {
  const params = job.params ?? {};
  if (job.itemIds) {
    const first = textTrackItems(timeline.tracks).find((item) => job.itemIds!.includes(item.id));
    return {
      start: first ? secondsOf(first.start) : 0,
      leaveOut: job.itemIds.slice(0, 48) as TimelineItemId[],
      params,
      ...(first ? { first } : {}),
    };
  }
  if (!job.anchor) return { start: 0, leaveOut: [], params };
  const rate = timeline.canvas.rate;
  const frames = Math.max(1, Math.round(((job.seconds ?? 3) * rate.num) / rate.den));
  const timing = resolveTiming(
    { anchor: job.anchor, frames, fallbackStart: 0 },
    timingContextOf(timeline, rate),
  );
  return { start: Math.max(0, (timing.start * rate.den) / rate.num), leaveOut: [], params };
}

/** The values the still is drawn with: the redesigned item's own words under this design, else the job's. */
function stillParams(timeline: Timeline, design: GraphicComposition, place: StillPlace): GraphicParamValues {
  const { first } = place;
  if (!first) return place.params;
  if (first.type === 'text') {
    const [word, ...more] = wordNames(design);
    return word && more.length === 0 ? { [word]: first.text } : {};
  }
  const from =
    compositionFor(first.composition, timeline.graphicCompositions) ??
    newestCopy(first.composition.id, timeline.graphicCompositions);
  return carriedParams(first.composition.params, from, design);
}

/** The bytes kept with the workspace's files when they are a picture a workspace file can hold. */
async function kept(
  deps: WorkspaceToolDeps,
  projectId: ProjectId,
  data: Uint8Array,
): Promise<GraphicOptionStill | undefined> {
  if (data.byteLength === 0 || data.byteLength > GRAPHIC_OPTION_STILL_BYTES) return undefined;
  const mimeType = workspaceImageType(data);
  if (!mimeType) return undefined;
  const put = await deps.store.putBlob(projectId, data);
  return put.ok ? { sha256: put.value.sha256, bytes: put.value.bytes, mimeType } : undefined;
}

export interface OptionStillInput {
  readonly projectId: ProjectId;
  readonly timeline: Timeline;
  readonly entry: GatedEntry;
  readonly composition: GraphicComposition;
  /** The artifact of the Designer's newest render of this option, when it drew one. */
  readonly poster: string | undefined;
  readonly place: StillPlace;
}

/** An option's still, kept with the workspace's files; undefined when none could be. */
export async function optionStill(
  deps: WorkspaceToolDeps,
  ctx: Pick<ToolContextBase, 'artifacts' | 'signal'>,
  input: OptionStillInput,
): Promise<GraphicOptionStill | undefined> {
  if (input.poster) {
    const stored = await ctx.artifacts.get(input.poster as ArtifactId);
    const own = stored.ok ? await kept(deps, input.projectId, stored.value.data) : undefined;
    if (own) return own;
  }
  if (!deps.frames) return undefined;
  const request: Omit<WorkspaceFramesInput, 'maxDimension'> = {
    projectId: input.projectId,
    entry: input.entry.entry.path,
    files: input.entry.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
    seconds: [Math.max(0, input.composition.durationSeconds / 2)],
    params: stillParams(input.timeline, input.composition, input.place),
    over: {
      kind: 'footage',
      timelineId: input.timeline.id,
      start: Math.min(3600, input.place.start),
      ...(input.place.leaveOut.length > 0 ? { leaveOut: [...input.place.leaveOut] } : {}),
    },
  };
  for (const maxDimension of TILE_STILL_SIDES) {
    if (ctx.signal.aborted) return undefined;
    const drawn = await deps.frames({ ...request, maxDimension }, { signal: ctx.signal });
    const frame = drawn.ok ? drawn.value.frames[0] : undefined;
    if (!frame) return undefined;
    const still = await kept(deps, input.projectId, Buffer.from(frame.dataBase64, 'base64'));
    if (still) return still;
  }
  return undefined;
}
