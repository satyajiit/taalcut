// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: live preview (render's preview session in the kit's PreviewPlayer)
 * system: DESIGN.md v0.4 · states: as PreviewFrame: opening (the frame's loading bone, "Preparing preview…" to
 *   screen readers) · loading · ready · updating · error with Load again, also when the session didn't open
 *   (UX1: its cause, never "Preparing preview…" for good) · pre-emit critique: P5 H4 E4 S5 R5 V4 */

/**
 * The real preview (P2-M7): render's preview session for this timeline
 * (`renders.openPreview`) in the kit's PreviewPlayer over proxies. After an
 * edit the timeline's revision moves on and the session is recompiled
 * (`refreshPreview`, 150 ms after the last change), which bumps the URL's
 * `rev`; the player swaps to it behind the frame on show. The session closes
 * when the page goes. An expired session opens again on Load again.
 */
import { useLingui } from '@lingui/react/macro';
import type { ProjectId, Timeline } from '@taalcut/core';
import { Button, cn, errorMessage, PreviewPlayer, VERB_ICONS } from '@taalcut/ui';
import { LoaderCircle } from 'lucide-react';
import { useEffect } from 'react';
import { usePlaybackActivity } from '../../sounds/sound-activity-context';
import { usePreviewRefresh } from './use-preview-refresh';
import type { TimelineViewerProps } from './viewer-types';

export interface LivePreviewProps extends Omit<TimelineViewerProps, 'frameUrl' | 'timeline'> {
  projectId: ProjectId;
  timeline: Timeline;
}

export function LivePreview({
  projectId,
  timeline,
  label,
  overlay,
  onReady,
  onFrame,
  onPlayingChange,
  className,
  ref,
}: LivePreviewProps) {
  const { t, i18n } = useLingui();
  const setSoundPlayback = usePlaybackActivity();
  const refresh = usePreviewRefresh(projectId, timeline.id, timeline.revision);
  const session = refresh.state?.session ?? null;
  useEffect(() => {
    if (!session) setSoundPlayback(false);
  }, [session, setSoundPlayback]);
  const failure = refresh.state?.failure ?? null;
  const current = refresh.state?.displayed !== null && (refresh.state?.displayed ?? -1) >= timeline.revision;

  return (
    <div className={cn('relative', className)} aria-busy={!failure && !current}>
      <PreviewPlayer
        ref={ref}
        src={session?.url ?? null}
        rate={session?.rate ?? timeline.canvas.rate}
        {...(session ? { durationFrames: session.durationFrames } : {})}
        width={session?.width ?? timeline.canvas.width}
        height={session?.height ?? timeline.canvas.height}
        label={label}
        overlay={overlay}
        empty={t`Preparing preview…`}
        pending={!session && !failure}
        failure={!session && failure ? errorMessage(i18n, failure) : null}
        onReady={(ready) => {
          refresh.painted(ready.src);
          onReady?.(ready);
        }}
        {...(onFrame ? { onFrame } : {})}
        onPlayingChange={(playing) => {
          setSoundPlayback(playing);
          onPlayingChange?.(playing);
        }}
        onRetry={refresh.retry}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      />
      {session && failure ? (
        <div
          role="alert"
          data-slot="preview-refresh-error"
          className="absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-overlay p-2 type-meta text-ink"
        >
          <span>{errorMessage(i18n, failure)}</span>
          <Button
            size="sm"
            variant="ghost"
            icon={VERB_ICONS.retry}
            onClick={refresh.retry}
          >{t`Try again`}</Button>
        </div>
      ) : session && !current ? (
        <div
          role="status"
          data-slot="preview-updating"
          title={t`Updating preview…`}
          className="pointer-events-none absolute right-2 top-2 rounded-md bg-overlay p-2 text-ink-2"
        >
          <LoaderCircle
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:[animation-duration:3s]"
          />
          <span className="sr-only">{t`Updating preview…`}</span>
        </div>
      ) : null}
    </div>
  );
}
