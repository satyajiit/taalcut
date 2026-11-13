// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-GFX: a graphics tool's call at a revision the video has moved past, refused with the revision it is at. The
 * local 9B sent revision 2 for a video at 1, was told only "Error core.conflict", and called graphics.list seven times
 * (tools/evals graphics:create); told the revision, it can call again.
 */
import { ConflictError, type TimelineId } from '@taalcut/core';

export const staleRevision = (timelineId: TimelineId, current: number) =>
  ConflictError(
    { entity: 'timeline', id: timelineId },
    { detail: `The video is at revision ${current} now: call again with revision ${current}.` },
  );
