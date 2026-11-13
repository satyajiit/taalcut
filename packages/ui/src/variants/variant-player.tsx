// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProjectId, TimelineId } from '@taalcut/core';
import { createContext, useContext, type ReactNode } from 'react';

/**
 * A preview the compare view's clock drives (P3-V3): the app's player for one timeline (render's preview session,
 * or the browser's stand-in), started at frame 0 whenever `epoch` moves while `playing`, paused on its first frame
 * otherwise. CardData.renderPreview plays on its own; this one has no transport of its own.
 */
export interface VariantPlayerProps {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  readonly revision: number;
  /** Already translated: "Preview of Variant 2". */
  readonly label: string;
  readonly playing: boolean;
  /** Bumped by the clock each time every player starts again together. */
  readonly epoch: number;
  readonly className?: string;
}

export type RenderVariantPlayer = (props: VariantPlayerProps) => ReactNode;

const VariantPlayerContext = createContext<RenderVariantPlayer | null>(null);

/** Where the app puts its drivable player; without one the compare view shows the plain previews (no Play the hooks). */
export function VariantPlayerProvider({
  render,
  children,
}: {
  render: RenderVariantPlayer;
  children: ReactNode;
}) {
  return <VariantPlayerContext.Provider value={render}>{children}</VariantPlayerContext.Provider>;
}

export function useVariantPlayer(): RenderVariantPlayer | null {
  return useContext(VariantPlayerContext);
}
