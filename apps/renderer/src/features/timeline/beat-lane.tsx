// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: beat lane · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * the music's beats as rose ticks under the clips (rhythm is rose's one job), each bar's first beat taller;
 *   decorative for assistive tech: the transport says the bar and beat in words
 * states: n/a (not interactive); empty (no beat map): the lane stays, without ticks · pre-emit critique: P4 H5 E5 S5 R5 V4 */
import { cn } from '@taalcut/ui';
import { memo } from 'react';
import type { TimelineModel } from './model';

export interface BeatLaneProps {
  model: TimelineModel;
  pxPerFrame: number;
}

/** Below this many pixels between beats only the downbeats are drawn: ticks closer than that read as a bar. */
const MIN_BEAT_PX = 5;

export const BeatLane = memo(function BeatLane({ model, pxPerFrame }: BeatLaneProps) {
  const sparse = model.beatFrames * pxPerFrame < MIN_BEAT_PX;
  return (
    <div aria-hidden data-slot="beat-lane" className="relative h-3">
      {model.beats.map((frame, index) => {
        const down = model.downbeats.has(index);
        if (sparse && !down) return null;
        return (
          <span
            key={index}
            data-downbeat={down || undefined}
            className={cn('absolute top-0 w-px rounded-pill', down ? 'h-3 bg-beat-strong' : 'h-1.5 bg-beat')}
            style={{ transform: `translateX(${frame * pxPerFrame}px)` }}
          />
        );
      })}
    </div>
  );
});
