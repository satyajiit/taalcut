// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Clip, Timeline } from '@taalcut/core';
import type { PreviewPlayerHandle, PreviewReady } from '@taalcut/ui';
import type { ComponentType, ReactNode, Ref } from 'react';

/**
 * What draws a timeline in a browser with no render process: the fake
 * services' stand-in viewer (preview/stand-in-viewer.tsx). In Electron
 * AppServices has none and the page plays render's preview session in the
 * kit's PreviewPlayer. Both take the same transport (PreviewPlayerHandle) and
 * report the same callbacks, so the editor doesn't know which it has.
 */
export interface TimelineViewerProps {
  timeline: Timeline;
  /** A picture of a clip's shot, sized for the viewer; null keeps the viewer grey. */
  frameUrl: (clip: Clip) => string | null;
  /** Names the frame for screen readers ("Video preview"). */
  label: string;
  /** Drawn over the frame: the safe-zone layer, a host's transport. */
  overlay?: ReactNode;
  onReady?: (ready: PreviewReady) => void;
  onFrame?: (frame: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  className?: string;
  ref?: Ref<PreviewPlayerHandle>;
}

export type TimelineViewer = ComponentType<TimelineViewerProps>;
