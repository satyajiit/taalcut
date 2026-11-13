// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: variant player (P3-V3) · genre: atmospheric studio app (the viewer) · system: DESIGN.md v0.3
 * one video of the compare view, driven by its shared clock: the viewer's 9:16 frame (the stand-in in a browser,
 *   render's preview session in Electron), started at frame 0 each time the clock's epoch moves while playing,
 *   paused on its first frame otherwise; footage only, no transport of its own
 * states: loading (the viewer grey) · ready (first frame) · playing · not interactive (the compare view's transport
 *   drives it) · empty/error: the viewer's own (Preparing preview…, Load again) · reduced motion: never mounted (the
 *   view shows posters) · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import type { Clip } from '@taalcut/core';
import { cn, type PreviewPlayerHandle, type VariantPlayerProps } from '@taalcut/ui';
import { useEffect, useRef, useState } from 'react';
import { useTimelineDocument } from '../../../backend/use-timeline-document';
import { useServices } from '../../../services/provider';
import { mediaOf } from '../model';
import { LivePreview } from '../preview/live-preview';
import { useShotLookup, useTimelineShots } from '../shot-frames';

const FRAME = { width: 270, height: 480 } as const;

export function VariantPlayer({
  projectId,
  timelineId,
  label,
  playing,
  epoch,
  className,
}: VariantPlayerProps) {
  const { viewer: StandIn } = useServices();
  const handle = useRef<PreviewPlayerHandle | null>(null);
  const [ready, setReady] = useState(false);
  const doc = useTimelineDocument(timelineId);
  const timeline = doc.data;
  const lookup = useShotLookup();
  useTimelineShots(timeline, lookup);

  // The clock's word is the only time this player keeps: every epoch starts it again from the top.
  useEffect(() => {
    const player = handle.current;
    if (!player || !ready) return;
    player.pause();
    player.seekFrame(0);
    if (playing) player.play();
  }, [playing, epoch, ready]);

  if (!timeline) return <div className={cn('tc-viewer aspect-[9/16] w-full rounded-xl', className)} />;
  const frameUrl = (clip: Clip) => {
    const media = mediaOf(clip);
    return lookup.frameNow(media.assetId, media.shotId, FRAME)?.url ?? null;
  };
  const common = {
    label,
    onReady: () => setReady(true),
    className: cn('flex w-full min-w-0 flex-col', className),
  };
  return StandIn ? (
    <StandIn ref={handle} timeline={timeline} frameUrl={frameUrl} {...common} />
  ) : (
    <LivePreview ref={handle} projectId={projectId} timeline={timeline} {...common} />
  );
}
