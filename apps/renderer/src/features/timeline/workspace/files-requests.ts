// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: "show this graphic's files", from wherever it is asked (a changes card's View files, the inspector): the
 * editor's dock opens on Files at that graphic's design. A tick its consumer claims once; one asked before the
 * editor is up waits for it (comment-requests.ts's store).
 */
import type { TimelineId, TimelineItemId } from '@taalcut/core';
import { createTickStore } from '../comments/comment-requests';

export interface FilesRequest {
  readonly timelineId: TimelineId;
  /** The graphic whose design to show; null for the first design on the video. */
  readonly itemId: TimelineItemId | null;
}

export const filesRequests = createTickStore<FilesRequest>();

/** Opens the editor's dock on Files, at a graphic's design. */
export const showFiles = (request: FilesRequest): void => filesRequests.push(request);
