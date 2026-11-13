// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How every timeline command writes (SPEC, "Edit commands"): read and
 * migrate, apply the pure edit (re-sync included), check the result, write it
 * with the expected revision, note `library.changed` for once the command
 * commits, and hand the bus an inverse (`timeline.restore` with the changed
 * parts as they were), so one ⌘Z undoes the edit and its re-sync together.
 */
import {
  err,
  ConflictError,
  ok,
  TIMELINE_COMMANDS,
  type timelineCommandPayloads,
  type AssetId,
  type AsyncResult,
  type BeatMap,
  type Clock,
  type CommandContext,
  type CommandOutcome,
  type CommitAnnouncer,
  type CommittedChange,
  type EventBus,
  type ProjectId,
  type Result,
  type StyleStore,
  type SubjectSource,
  type TemplateStore,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
  type TimelineStore,
} from '@taalcut/core';
import type { z } from 'zod';
import type { NarrationAssets } from './narration-types';
import type { TranscriptReader } from '../service/transcript';
import type { ShotCatalog } from '../casting/catalog';
import type { CastingConfig } from '../casting/config';
import type { EditResult, TimelinePart } from '../edits/types';
import type { EnergyDeps } from '../energy/energy-deps';
import type { InterchangeDeps } from '../interchange/export-interchange';
import { TimelineNotFound } from '../errors';
import { affectedItems } from './mutation-receipt';
import type { EditConfig } from '../model/config';
import type { TemplateReader } from '../service/templates';
import { namedNotFound } from '../model/not-found';
import { checkEdited, migrateTimeline } from '../model/validate';

export interface TimelineCommandDeps {
  readonly transcripts?: TranscriptReader;
  readonly narration?: NarrationAssets;
  readonly store: TimelineStore;
  readonly events: EventBus;
  readonly clock: Clock;
  /** Shot profiles for swaps and applyCast. Absent: those two answer core.not_implemented. */
  readonly catalog?: ShotCatalog;
  /**
   * Template versions: the reel's beat map, which choosing the reel's own music (path d) puts the cuts back on after
   * an own track moved them. Absent: the cuts stay where they are.
   */
  readonly templates?: TemplateReader;
  /**
   * The beat map of the user's own track (audio's tracker on the asset), in the track's time; null when it has
   * none yet. Absent or null: choosing the track (render path b) keeps the cuts where they are.
   */
  readonly trackBeats?: (assetId: AssetId, signal?: AbortSignal) => AsyncResult<BeatMap | null>;
  readonly config?: EditConfig;
  readonly casting?: CastingConfig;
  readonly ids?: () => TimelineItemId;
  /** P3: template heads, for restore's `templateHead` (the energy curve's undo). Absent: that part is refused. */
  readonly templateStore?: Pick<TemplateStore, 'setHead'>;
  /** P3-V5: the registered writers, the originals and Taalcut's exports folder. Absent: not implemented. */
  readonly interchange?: InterchangeDeps;
  /** P3-V10, P3-V16: the Style a timeline takes. Absent: setStyle and batch.applyStyle are not implemented. */
  readonly styles?: Pick<StyleStore, 'get'>;
  /** P3-V12: the template half of the energy curve and its versioning. Absent: not implemented. */
  readonly energy?: EnergyDeps;
  /**
   * FRM1-OVL: who is in each clip, so a swap or new words place the overlays again clear of heads (with
   * `templates`). Absent: they keep the reel's relation with nobody known on screen.
   */
  readonly subjects?: SubjectSource;
}

/** What the handlers share inside the package: the deps plus the one announcer `createTimelineCommands` attaches. */
export interface CommandDeps extends TimelineCommandDeps {
  readonly announcer: CommitAnnouncer;
}

export interface TimelineResult {
  readonly timelineId: TimelineId;
  readonly revision: number;
  readonly affectedItemIds: string[];
}

/** The timeline, if it belongs to `projectId` (another project's id reads as not found). */
export async function readFor(
  store: TimelineStore,
  timelineId: TimelineId,
  projectId: ProjectId,
): AsyncResult<Timeline> {
  const stored = namedNotFound(await store.get(timelineId), () => TimelineNotFound({ timelineId }));
  if (!stored.ok) return stored;
  const timeline = migrateTimeline(stored.value.json, stored.value.schemaVersion);
  if (!timeline.ok) return timeline;
  if (timeline.value.projectId !== projectId) return err(TimelineNotFound({ timelineId }));
  return timeline;
}

/** Notes a change to timelines, sent as `library.changed` once the command commits (core's commit announcer). */
export function noteTimelines(
  deps: CommandDeps,
  context: CommandContext,
  change: Omit<CommittedChange, 'entity'>,
): void {
  deps.announcer.note(context, { ...change, entity: 'timeline' });
}

/** Bumps the revision, checks the document and writes it over `current`'s revision. */
export async function commit(
  deps: CommandDeps,
  current: Timeline,
  next: Timeline,
  context: CommandContext,
): AsyncResult<Timeline> {
  const finalised = checkEdited({
    ...next,
    revision: current.revision + 1,
    updatedAt: Math.max(deps.clock.now(), current.updatedAt),
  });
  if (!finalised.ok) return finalised;
  const written = await deps.store.put(finalised.value, current.revision, context);
  if (!written.ok) return written;
  // Sent once the staged write commits with the audit row, not now (core's commit announcer).
  noteTimelines(deps, context, { projectId: current.projectId, change: 'updated', ids: [current.id] });
  return ok(finalised.value);
}

/** `timeline.restore`'s payload: the parts an edit changed, as they were. */
export function restorePayload(timeline: Timeline, parts: readonly TimelinePart[]) {
  return {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    ...(parts.includes('tracks') ? { tracks: timeline.tracks } : {}),
    ...(parts.includes('markers') ? { markers: timeline.markers } : {}),
    ...(parts.includes('cast') ? { cast: timeline.cast } : {}),
    ...(parts.includes('beatMap') ? { beatMap: timeline.beatMap } : {}),
    ...(parts.includes('music') ? { music: timeline.music } : {}),
    ...(parts.includes('captions') ? { captions: timeline.captions } : {}),
    ...(parts.includes('style') ? { styleId: timeline.styleId } : {}),
    ...(parts.includes('voiceover') ? { voiceover: timeline.voiceover } : {}),
    ...(parts.includes('mix') ? { mix: timeline.mix } : {}),
    ...(parts.includes('template') ? { template: timeline.template } : {}),
    ...(parts.includes('covers') ? { covers: timeline.covers ?? null } : {}),
    ...(parts.includes('grade') ? { grade: timeline.grade ?? null } : {}),
  };
}

/** The document field each restore part sets (restorePayload's keys back to parts). */
export const PART_OF_FIELD = {
  tracks: 'tracks',
  markers: 'markers',
  cast: 'cast',
  beatMap: 'beatMap',
  music: 'music',
  captions: 'captions',
  styleId: 'style',
  voiceover: 'voiceover',
  mix: 'mix',
  template: 'template',
  grade: 'grade',
  covers: 'covers',
} as const satisfies Record<string, TimelinePart>;

type RestorePayload = z.output<(typeof timelineCommandPayloads)[typeof TIMELINE_COMMANDS.restore]>;

/** The parts a `timeline.restore` payload names, as document fields; a null `grade` is "none" (restoredTimeline). */
export function restoredParts(payload: RestorePayload): Partial<Pick<Timeline, keyof typeof PART_OF_FIELD>> {
  const out: Partial<Pick<Timeline, keyof typeof PART_OF_FIELD>> = {};
  if (payload.tracks !== undefined) out.tracks = payload.tracks;
  if (payload.markers !== undefined) out.markers = payload.markers;
  if (payload.cast !== undefined) out.cast = payload.cast;
  if (payload.beatMap !== undefined) out.beatMap = payload.beatMap;
  if (payload.music !== undefined) out.music = payload.music;
  if (payload.captions !== undefined) out.captions = payload.captions;
  if (payload.styleId !== undefined) out.styleId = payload.styleId;
  if (payload.voiceover !== undefined) out.voiceover = payload.voiceover;
  if (payload.mix !== undefined) out.mix = payload.mix;
  if (payload.template !== undefined) out.template = payload.template;
  if (payload.covers !== undefined && payload.covers !== null) out.covers = payload.covers;
  if (payload.grade !== undefined && payload.grade !== null) out.grade = payload.grade;
  return out;
}

/** The timeline with a restore payload's parts put back, and the parts it names. */
export function restoredTimeline(
  timeline: Timeline,
  payload: RestorePayload,
): { readonly timeline: Timeline; readonly changed: TimelinePart[] } {
  const parts = restoredParts(payload);
  const next: Timeline = { ...timeline, ...parts };
  if (payload.covers === null) delete next.covers;
  if (payload.grade === null) delete next.grade;
  const fields = Object.keys(parts).filter((key) => key !== 'grade');
  if (payload.covers === null) fields.push('covers');
  const changed = fields.map((key) => PART_OF_FIELD[key as keyof typeof PART_OF_FIELD]);
  return { timeline: next, changed: payload.grade !== undefined ? [...changed, 'grade'] : changed };
}

/** Runs one edit as a command: no change writes nothing and leaves nothing to undo. */
export async function writeEdit(
  deps: CommandDeps,
  payload: {
    readonly projectId: ProjectId;
    readonly timelineId: TimelineId;
    readonly revision?: number | undefined;
  },
  context: CommandContext,
  edit: (timeline: Timeline) => Result<EditResult> | AsyncResult<EditResult>,
): AsyncResult<CommandOutcome<TimelineResult>> {
  const current = await readFor(deps.store, payload.timelineId, payload.projectId);
  if (!current.ok) return current;
  if (
    payload.revision !== undefined &&
    context.replay !== 'redo' &&
    payload.revision !== current.value.revision
  )
    return err(ConflictError({ entity: 'timeline', id: payload.timelineId }));
  const edited = await edit(current.value);
  if (!edited.ok) return edited;
  if (edited.value.changed.length === 0)
    return ok({
      result: { timelineId: current.value.id, revision: current.value.revision, affectedItemIds: [] },
    });
  const written = await commit(deps, current.value, edited.value.timeline, context);
  if (!written.ok) return written;
  return ok({
    result: {
      timelineId: written.value.id,
      revision: written.value.revision,
      affectedItemIds: affectedItems(current.value, written.value),
    },
    inverse: {
      name: TIMELINE_COMMANDS.restore,
      payload: restorePayload(current.value, edited.value.changed),
    },
  });
}
