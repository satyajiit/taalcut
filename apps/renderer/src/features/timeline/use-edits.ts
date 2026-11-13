// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The editor's edits (P2-M7, R14): each one a timeline command on the bus
 * from 'ui' (TIMELINE_COMMANDS), so ⌘Z undoes it in the project's history
 * and the audit log keeps it. Nothing changes on screen until the timeline's
 * watch stream brings the new revision (the command re-syncs cuts to the
 * beat, which only the timeline knows how to do). A refused edit keeps its
 * cause until the next edit, for the line under the transport.
 */
import {
  err,
  NotFoundError,
  TIMELINE_COMMANDS,
  type CastCandidate,
  type ProjectId,
  type Result,
  type TaalcutError,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import { useCallback, useState } from 'react';
import { useTimelineDocument } from '../../backend/use-timeline-document';
import { useCommand } from '../../backend/use-command';
import { atRate, type TimelineModel } from './model';

export interface Edits {
  pending: boolean;
  error: TaalcutError | null;
  clearError(): void;
  /** Moves a clip's edge by `frames` (positive lengthens it at that edge). */
  trim(clipId: TimelineItemId, edge: 'start' | 'end', frames: number): Promise<Result<unknown>>;
  move(clipId: TimelineItemId, toIndex: number): Promise<Result<unknown>>;
  swap(
    clipId: TimelineItemId,
    candidate: CastCandidate,
    from: 'alternate' | 'search',
  ): Promise<Result<unknown>>;
  lock(clipId: TimelineItemId, locked: boolean): Promise<Result<unknown>>;
  editText(itemId: TimelineItemId, text: string): Promise<Result<unknown>>;
  /** EDT1-OPS: any other timeline command, with the project and timeline filled in (edit-ops.ts). */
  command(name: string, payload: Record<string, unknown>): Promise<Result<unknown>>;
}

export function useEdits(
  projectId: ProjectId,
  timelineId: TimelineId | undefined,
  model: TimelineModel | null,
): Edits {
  const command = useCommand({ toast: false });
  const document = useTimelineDocument(timelineId);
  const revision = document.data?.revision;
  const [error, setError] = useState<TaalcutError | null>(null);
  const { run } = command;
  const rate = model?.rate;

  const edit = useCallback(
    async (name: string, payload: Record<string, unknown>): Promise<Result<unknown>> => {
      if (!timelineId) return err(NotFoundError({ entity: 'timeline', id: '' }));
      setError(null);
      const result = await run({ name, payload: { projectId, timelineId, revision, ...payload } });
      if (!result.ok) setError(result.error);
      return result;
    },
    [run, projectId, timelineId, revision],
  );

  return {
    pending: command.pending,
    error,
    clearError: useCallback(() => setError(null), []),
    trim: useCallback(
      (clipId, edge, frames) =>
        edit(TIMELINE_COMMANDS.trimClip, { clipId, edge, by: atRate(frames, rate ?? { num: 30, den: 1 }) }),
      [edit, rate],
    ),
    move: useCallback((clipId, toIndex) => edit(TIMELINE_COMMANDS.moveClip, { clipId, toIndex }), [edit]),
    swap: useCallback(
      (clipId, candidate, from) =>
        edit(TIMELINE_COMMANDS.swapClip, {
          clipId,
          media: { assetId: candidate.assetId, shotId: candidate.shotId },
          sourceStart: candidate.sourceStart,
          from,
          scored: { score: candidate.score, parts: candidate.parts },
        }),
      [edit],
    ),
    lock: useCallback((clipId, locked) => edit(TIMELINE_COMMANDS.lockClip, { clipId, locked }), [edit]),
    editText: useCallback(
      (itemId, text) => edit(TIMELINE_COMMANDS.editText, { itemId, text: text.trim() }),
      [edit],
    ),
    command: edit,
  };
}
