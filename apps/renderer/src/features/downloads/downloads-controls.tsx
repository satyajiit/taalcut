// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the download's controls · genre: atmospheric studio app · system: DESIGN.md v0.5 (UX2)
 * the one or two things the download can do now (UX2-DOWNLOADER), small buttons that stay neutral (background work
 *   runs neutral: secondary, never marigold): Download with its size, Pause, Resume or Try again, and a quiet
 *   ghost Cancel. Cancel asks first, in place, because it deletes what has arrived: one line saying so, "Keep
 *   downloading" (focused, the safe choice) and "Cancel download" (destructive, saying what it destroys). Escape
 *   keeps downloading; focus goes back to Cancel. The first button is one control whose words follow the state
 *   (Pause becomes Resume), so focus stays on it as it changes.
 * states: Button's eight (default, hover, focus-visible, active, disabled n/a, loading while its command runs,
 *   error and success are the download's own: its summary and rows say them) · confirming (the line and two
 *   buttons) · ready (nothing)
 * pre-emit critique: P5 H4 E5 S4 R5 V4 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41 via axe, 46-49)
 */
import { useLingui } from '@lingui/react/macro';
import type { Downloads } from '@taalcut/core';
import { Button, cn } from '@taalcut/ui';
import { Download, Pause, Play, RotateCw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatBytes } from '../shared/format';
import type { DownloadAction, DownloadActions } from './use-download-actions';

interface Primary {
  readonly action: string;
  readonly command: DownloadAction;
  readonly icon: ReactNode;
  readonly label: string;
  readonly run: () => void;
}

export function DownloadsControls({
  downloads,
  actions,
  className,
}: {
  downloads: Downloads;
  actions: DownloadActions;
  className?: string;
}) {
  const { t, i18n } = useLingui();
  const [confirming, setConfirming] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  /** Where focus goes when the question closes: back to Cancel, or to the first button after cancelling. */
  const after = useRef<'cancel' | 'primary' | null>(null);
  const lineId = useId();
  useEffect(() => {
    if (confirming) keep.current?.focus();
    else if (after.current === 'cancel') cancel.current?.focus();
    else if (after.current === 'primary') primary.current?.focus();
    after.current = null;
  }, [confirming]);
  const ask = (open: boolean, then: 'cancel' | 'primary') => {
    after.current = then;
    setConfirming(open);
  };

  const { state } = downloads;
  if (state === 'ready') return null;
  if (confirming)
    return (
      <div
        role="group"
        aria-labelledby={lineId}
        data-slot="downloads-cancel"
        className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') ask(false, 'cancel');
        }}
      >
        <p id={lineId} className="m-0 text-sm text-ink">
          {t`Cancel the download? What has arrived of the parts not here yet is deleted.`}
        </p>
        <span className="flex gap-2">
          <Button ref={keep} size="sm" variant="secondary" onClick={() => ask(false, 'cancel')}>
            {t`Keep downloading`}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            data-action="cancel-downloads"
            onClick={() => {
              ask(false, 'primary');
              actions.cancel();
            }}
          >
            {t`Cancel download`}
          </Button>
        </span>
      </div>
    );

  const left = formatBytes(i18n, Math.max(0, downloads.bytesTotal - downloads.bytesDone));
  const first: Record<Exclude<Downloads['state'], 'ready'>, Primary> = {
    missing: {
      action: 'download-models',
      command: 'start',
      icon: <Download aria-hidden />,
      label: t`Download ${left}`,
      run: () => actions.start(),
    },
    downloading: {
      action: 'pause-downloads',
      command: 'pause',
      icon: <Pause aria-hidden />,
      label: t`Pause`,
      run: actions.pause,
    },
    paused: {
      action: 'resume-downloads',
      command: 'resume',
      icon: <Play aria-hidden />,
      label: t`Resume`,
      run: actions.resume,
    },
    failed: {
      action: 'retry-downloads',
      command: 'resume',
      icon: <RotateCw aria-hidden />,
      label: t`Try again`,
      run: actions.resume,
    },
  };
  const now = first[state];
  // Something to cancel: parts on their way or paused, or parts that failed or arrived part way.
  const started =
    state === 'downloading' ||
    state === 'paused' ||
    (state === 'failed' && (downloads.counts.failed > 0 || downloads.bytesDone > 0));
  return (
    <span data-slot="downloads-controls" className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button
        ref={primary}
        size="sm"
        data-action={now.action}
        loading={actions.pending === now.command}
        onClick={now.run}
      >
        {now.icon}
        {now.label}
      </Button>
      {started ? (
        <Button
          ref={cancel}
          size="sm"
          variant="ghost"
          data-action="ask-cancel-downloads"
          loading={actions.pending === 'cancel'}
          onClick={() => ask(true, 'cancel')}
        >
          {t`Cancel`}
        </Button>
      ) : null}
    </span>
  );
}
