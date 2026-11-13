// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the saved reel beside a showcase · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the reel frame's own (poster, playing on screen, paused by the visitor, reduced motion never starting by
 *   itself) · its segment bar fills stories-style from the video's clock, the rose beat ticks swelling as it plays ·
 *   the stickers pop once and lean toward a fine pointer
 * The Vietnam reel, as saved, in the world's 28 px frame: the template's slots as the segmented bar on top (the cut
 * the AI wasn't sure of dashed), and facts as stickers hanging off its edge. Pass `time` to drive the window's own
 * playhead from the same clock. */

import { type MotionValue, useMotionValue } from 'motion/react';
import type { ReactNode } from 'react';
import { type Segment, SegmentBar } from '#components/ui/segment-bar';
import { ReelFrame } from '#components/ui/reel-frame';
import { DEFAULT_REEL_ID, reelById } from '#content/reels';
import type { Reel } from '#content/schema';

/** The reel's slots as the segment bar's segments. */
export function reelSegments(reel: Reel): Segment[] {
  return reel.slots.map((s) => ({ start: s.start, end: s.end, group: s.role, unsure: s.uncertainCut }));
}

export function ReelSide({
  label,
  time,
  stickers,
  children,
}: {
  /** What the reel is, for assistive technology. */
  readonly label?: string;
  readonly time?: MotionValue<number>;
  readonly stickers?: ReactNode;
  readonly children?: ReactNode;
}) {
  const own = useMotionValue(0);
  const clock = time ?? own;
  const reel = reelById(DEFAULT_REEL_ID);
  return (
    <ReelFrame
      sources={reel.reference}
      poster={reel.poster}
      label={label ?? `A saved reel: ${reel.title}`}
      time={clock}
      bar={
        <SegmentBar
          segments={reelSegments(reel)}
          beats={reel.beats}
          time={clock}
          state="playing"
          layout="time"
        />
      }
      stickers={stickers}
    >
      {children}
    </ReelFrame>
  );
}

/** A sticker's place on the reel's edge: absolutely placed, hanging off the frame a little. */
export function OnEdge({ at, children }: { readonly at: string; readonly children: ReactNode }) {
  return <span className={`absolute ${at}`}>{children}</span>;
}
