// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, type RenderSnapshot, type TimelineId } from '@taalcut/core';
import type { CardData } from '@taalcut/ui';
import type { Backend } from '../../../backend/backend';
import { followStream } from '../../../chat/follow-stream';

/** The newest render of a timeline that isn't deleted, or null. */
export function newestRender(
  renders: readonly RenderSnapshot[],
  timelineId: TimelineId,
): RenderSnapshot | null {
  let newest: RenderSnapshot | null = null;
  for (const render of renders)
    if (
      render.timelineId === timelineId &&
      render.deletedAt === null &&
      (!newest || render.createdAt > newest.createdAt)
    )
      newest = render;
  return newest;
}

/**
 * P3-V3: the newest render of each variant, for the compare card's tiles (timelines.get for its project, then
 * renders.watch over that project). A render doesn't record what it was for, so the newest one answers either
 * purpose.
 */
export function variantsCardData(backend: Backend): Pick<CardData, 'watchLatestRender'> {
  return {
    watchLatestRender(timelineId, _purpose, onChange) {
      let stop = () => {};
      let stopped = false;
      void callRpc(backend.timelines.get({ timelineId })).then((got) => {
        if (stopped) return;
        if (!got.ok) return onChange(null);
        stop = followStream(
          (signal) => backend.renders.watch({ projectId: got.value.projectId }, { signal }),
          (renders) => onChange(newestRender(renders, timelineId)),
          () => onChange(null),
        );
      });
      return () => {
        stopped = true;
        stop();
      };
    },
  };
}
