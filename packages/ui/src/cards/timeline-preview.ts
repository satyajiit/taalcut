// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProjectId, TimelineId } from '@taalcut/core';

/** What `CardData.renderPreview` draws: one timeline at a revision, sized by its box. */
export interface TimelinePreviewProps {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  readonly revision: number;
  /** The kit's label for the frame, already translated. */
  readonly label: string;
  /** The frame on show changed (about ten times a second while playing), for the card's playhead. */
  readonly onFrame?: (frame: number) => void;
  readonly className?: string;
}
