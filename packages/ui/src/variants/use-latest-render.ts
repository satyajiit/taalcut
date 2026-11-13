// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { RenderSnapshot, TimelineId } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useCardData } from '../cards/card-data';

/**
 * The newest export of a timeline, kept current (CardData.watchLatestRender): null when it has none or the app
 * can't say, so a tile without renders shows no render line.
 */
export function useLatestRender(timelineId: TimelineId | null): RenderSnapshot | null {
  const data = useCardData();
  const [render, setRender] = useState<RenderSnapshot | null>(null);
  useEffect(() => {
    setRender(null);
    if (!timelineId || !data.watchLatestRender) return;
    return data.watchLatestRender(timelineId, 'export', setRender);
  }, [data, timelineId]);
  return render;
}
