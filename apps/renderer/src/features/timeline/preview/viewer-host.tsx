// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The editor's viewer: render's preview session in Electron, the fake
 * services' stand-in in a plain browser (AppServices.viewer), tied to the
 * playhead both ways. The player reports frames as it plays; the playhead
 * follows. A scrub or a seek moves the playhead; the player follows, once per
 * animation frame however fast the pointer moves.
 */
import { useLingui } from '@lingui/react/macro';
import type { Clip, ProjectId, Timeline } from '@taalcut/core';
import type { PreviewPlayerHandle } from '@taalcut/ui';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useServices } from '../../../services/provider';
import { fpsOf } from '../model';
import { usePlayheadFrame, type Playhead } from '../playhead';
import { LivePreview } from './live-preview';

export interface ViewerHostProps {
  projectId: ProjectId;
  timeline: Timeline;
  totalFrames: number;
  frameUrl: (clip: Clip) => string | null;
  playhead: Playhead;
  handle: RefObject<PreviewPlayerHandle | null>;
  overlay?: ReactNode;
  className?: string;
}

export function ViewerHost({
  projectId,
  timeline,
  totalFrames,
  frameUrl,
  playhead,
  handle,
  overlay,
  className,
}: ViewerHostProps) {
  const { t } = useLingui();
  const { viewer: StandIn } = useServices();
  const pending = useRef<number | null>(null);
  const raf = useRef(0);
  const fps = fpsOf(timeline.canvas.rate);

  usePlayheadFrame(playhead, (frame, source) => {
    if (source !== 'user') return;
    pending.current = frame;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      if (pending.current !== null) handle.current?.seekFrame(pending.current);
      pending.current = null;
    });
  });

  // The transport's play and pause (Space, the button) go to whichever viewer this is.
  useEffect(() => {
    playhead.bindTransport({ play: () => handle.current?.play(), pause: () => handle.current?.pause() });
    return () => playhead.bindTransport(null);
  }, [playhead, handle]);

  const callbacks = {
    onReady: () => playhead.setFilm(totalFrames, fps),
    onFrame: (frame: number) => playhead.seek(frame, 'player'),
    onPlayingChange: (playing: boolean) => playhead.setPlaying(playing),
  };
  const label = t`Video preview`;

  return StandIn ? (
    <StandIn
      ref={handle}
      timeline={timeline}
      frameUrl={frameUrl}
      label={label}
      overlay={overlay}
      {...callbacks}
      {...(className ? { className } : {})}
    />
  ) : (
    <LivePreview
      ref={handle}
      projectId={projectId}
      timeline={timeline}
      label={label}
      overlay={overlay}
      {...callbacks}
      {...(className ? { className } : {})}
    />
  );
}
