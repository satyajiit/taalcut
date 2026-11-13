// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Timeline } from '@taalcut/core';
import { CardActionsProvider, CardDataProvider, CoverEditor } from '@taalcut/ui';
import { useAppCardActions } from '../../chat/card-actions';
import { useAppCardData } from '../../chat/card-data';
import type { Playhead } from './playhead';

export function CoverPanel({
  timeline,
  playhead,
  paused,
}: {
  timeline: Timeline;
  playhead: Playhead;
  paused: boolean;
}) {
  const actions = useAppCardActions();
  const data = useAppCardData();
  return (
    <CardActionsProvider value={actions}>
      <CardDataProvider value={data}>
        <div className="p-4">
          <CoverEditor timeline={timeline} currentFrame={() => playhead.frame()} paused={paused} />
        </div>
      </CardDataProvider>
    </CardActionsProvider>
  );
}
