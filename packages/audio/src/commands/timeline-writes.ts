// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How audio's timeline commands write (voice.applyVoiceover, music.setDucking, sfx.setHits; SPEC P3.10): read and
 * upgrade the stored document, check the caller's revision, apply a pure change, check the result with core's
 * timelineSchema, write it over the revision it was read at (core.conflict otherwise), note `library.changed` for
 * once the command commits, and give the bus `timeline.restore` with the changed parts as they were.
 *
 * Redo runs a command's original payload again (core bus), and that payload's `revision` is the one it was made
 * against, which the undo has since moved on. The bus says so (`context.replay === 'redo'`, also after a restart,
 * when the redo stack comes from the audit log), and a redo skips the stale-revision check: any audited command in
 * the same history clears the redo stack first, so the state the payload was computed against is back, only at a
 * newer revision (render's `captions.applyTranslation` does the same).
 */
import {
  ConflictError,
  affectedTimelineItems,
  err,
  NotFoundError,
  ok,
  TIMELINE_COMMANDS,
  timelineSchema,
  upgradeTimeline,
  ValidationError,
  type AsyncResult,
  type Clock,
  type CommandContext,
  type CommandOutcome,
  type CommitAnnouncer,
  type ProjectId,
  type Result,
  type Timeline,
  type TimelineId,
  type TimelineStore,
} from '@taalcut/core';

export interface TimelineWriteDeps {
  readonly store: TimelineStore;
  readonly clock: Clock;
  readonly announcer: CommitAnnouncer;
}

/** The parts of a timeline audio's commands change; each is restored as it was on undo. */
export type AudioTimelinePart = 'tracks' | 'voiceover' | 'mix';

export interface TimelineTarget {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  /** When given, a stored revision other than this is core.conflict. */
  readonly revision?: number | undefined;
}

export interface WrittenTimeline {
  readonly timelineId: TimelineId;
  readonly revision: number;
  readonly affectedItemIds?: string[];
}

/** The timeline, if it belongs to the target's project and is at the target's revision (when one is given). */
export async function readTimeline(store: TimelineStore, target: TimelineTarget): AsyncResult<Timeline> {
  const stored = await store.get(target.timelineId);
  if (!stored.ok) return stored;
  const timeline = upgradeTimeline(stored.value.json, stored.value.schemaVersion);
  if (!timeline.ok) return timeline;
  if (timeline.value.projectId !== target.projectId)
    return err(NotFoundError({ entity: 'timeline', id: target.timelineId }));
  if (target.revision !== undefined && target.revision !== timeline.value.revision)
    return err(
      ConflictError(
        { entity: 'timeline', id: target.timelineId },
        { detail: `revision ${target.revision} asked, ${timeline.value.revision} stored` },
      ),
    );
  return timeline;
}

/** `timeline.restore`'s payload: the parts a change touched, as they were. */
export function restorePayload(timeline: Timeline, parts: readonly AudioTimelinePart[]) {
  return {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    ...(parts.includes('tracks') ? { tracks: timeline.tracks } : {}),
    ...(parts.includes('voiceover') ? { voiceover: timeline.voiceover } : {}),
    ...(parts.includes('mix') ? { mix: timeline.mix } : {}),
  };
}

export interface TimelineChange {
  readonly timeline: Timeline;
  /** Empty: nothing changed, nothing is written and there is nothing to undo. */
  readonly changed: readonly AudioTimelinePart[];
}

/** Runs one change as a command, with `timeline.restore` as its inverse. */
async function writeTimelineChange(
  deps: TimelineWriteDeps,
  target: TimelineTarget,
  context: CommandContext,
  change: (timeline: Timeline) => Result<TimelineChange> | AsyncResult<TimelineChange>,
): AsyncResult<CommandOutcome<WrittenTimeline>> {
  const current = await readTimeline(deps.store, target);
  if (!current.ok) return current;
  const changed = await change(current.value);
  if (!changed.ok) return changed;
  if (changed.value.changed.length === 0)
    return ok({ result: { timelineId: current.value.id, revision: current.value.revision } });
  const checked = timelineSchema.safeParse({
    ...changed.value.timeline,
    revision: current.value.revision + 1,
    updatedAt: Math.max(deps.clock.now(), current.value.updatedAt),
  });
  if (!checked.success) {
    const detail = checked.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return err(ValidationError({ field: 'timeline' }, { detail: detail.slice(0, 2000) }));
  }
  const written = await deps.store.put(checked.data, current.value.revision, context);
  if (!written.ok) return written;
  deps.announcer.note(context, {
    projectId: current.value.projectId,
    entity: 'timeline',
    change: 'updated',
    ids: [current.value.id],
  });
  return ok({
    result: {
      timelineId: checked.data.id,
      revision: checked.data.revision,
      affectedItemIds: affectedTimelineItems(current.value, checked.data),
    },
    inverse: {
      name: TIMELINE_COMMANDS.restore,
      payload: restorePayload(current.value, changed.value.changed),
    },
  });
}

export interface TimelineWriter {
  /** Runs one change as a command, with `timeline.restore` as its inverse; a redo skips the revision check. */
  write(
    target: TimelineTarget,
    context: CommandContext,
    change: (timeline: Timeline) => Result<TimelineChange> | AsyncResult<TimelineChange>,
  ): AsyncResult<CommandOutcome<WrittenTimeline>>;
}

/** One writer per command factory; the bus's context says when a write is a redo. */
export function createTimelineWriter(deps: TimelineWriteDeps): TimelineWriter {
  return {
    write: (target, context, change) =>
      writeTimelineChange(
        deps,
        context.replay === 'redo' ? { ...target, revision: undefined } : target,
        context,
        change,
      ),
  };
}
