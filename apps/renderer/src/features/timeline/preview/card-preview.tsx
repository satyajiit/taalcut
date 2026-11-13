// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: card preview · genre: atmospheric studio app (the viewer) · system: DESIGN.md v0.3
 * a timeline card's cut, playable in place: the viewer's 9:16 frame (the stand-in in a browser, render's
 *   preview session in Electron); pressing it plays or pauses, a play mark sits on the grey while paused
 * states: default · hover (the mark brightens) · focus (base ring on the frame) · active (pressed) · playing
 *   (no mark) · loading (the viewer grey) · empty/error: the viewer's own (Preparing preview…, Load again) ·
 *   reduced motion: the stand-in's push-in off · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { Clip } from '@taalcut/core';
import { cn, type PreviewPlayerHandle, type TimelinePreviewProps } from '@taalcut/ui';
import { Pause, Play } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTimelineDocument } from '../../../backend/use-timeline-document';
import { useServices } from '../../../services/provider';
import { mediaOf } from '../model';
import { useShotLookup, useTimelineShots } from '../shot-frames';
import { LivePreview } from './live-preview';

const FRAME = { width: 270, height: 480 } as const;

export function CardPreview({ projectId, timelineId, label, onFrame, className }: TimelinePreviewProps) {
  const { t } = useLingui();
  const { viewer: StandIn } = useServices();
  const handle = useRef<PreviewPlayerHandle | null>(null);
  const [playing, setPlaying] = useState(false);
  const doc = useTimelineDocument(timelineId);
  const timeline = doc.data;
  const lookup = useShotLookup();
  useTimelineShots(timeline, lookup);

  if (!timeline) return <div className={cn('tc-viewer aspect-[9/16] w-full rounded-lg', className)} />;
  const frameUrl = (clip: Clip) => {
    const media = mediaOf(clip);
    return lookup.frameNow(media.assetId, media.shotId, FRAME)?.url ?? null;
  };
  const common = {
    label,
    onPlayingChange: setPlaying,
    ...(onFrame ? { onFrame } : {}),
    className: 'flex w-full min-w-0 flex-col',
  };
  const toggle = () => (playing ? handle.current?.pause() : handle.current?.play());
  return (
    <div className={cn('group/preview relative', className)} data-slot="card-preview">
      {StandIn ? (
        <StandIn ref={handle} timeline={timeline} frameUrl={frameUrl} {...common} />
      ) : (
        <LivePreview ref={handle} projectId={projectId} timeline={timeline} {...common} />
      )}
      <button
        type="button"
        aria-label={playing ? t`Pause` : t`Play`}
        className="absolute inset-0 grid cursor-pointer place-items-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        onClick={toggle}
      >
        <span
          aria-hidden
          className={cn(
            'grid size-8 place-items-center rounded-pill bg-raised text-ink opacity-90 shadow-sm transition-opacity duration-(--dur-micro) ease-(--ease-out) group-hover/preview:opacity-100 group-active/preview:opacity-60',
            playing && 'opacity-0 group-hover/preview:opacity-90',
          )}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </span>
      </button>
    </div>
  );
}
