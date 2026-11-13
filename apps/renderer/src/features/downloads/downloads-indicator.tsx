// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the window bar's downloads · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.5 (UX2, Window › Downloads) · at the bar's right end, after the page's actions, on every page
 *   in the shell (not first run, whose rail has its own line): a 28 px ghost icon button, like the sidebar button.
 *   While the models download, a 16 px ring fills with the download in ink-2 on a rule track (background work runs
 *   neutral; no accent). Paused: the ring holds, a pause glyph inside. Stopped with parts missing: the danger
 *   icon. Not downloaded: the download glyph. Done: the success mark for four seconds, then it fades away; nothing
 *   shows while everything is here. Pressing it opens a popover under it (instantly, as DESIGN.md's popovers do):
 *   the summary line over its bar, the controls, a row per job and a link to Settings › Models. Light dismiss,
 *   Escape and the button close it; focus goes back to the button. Pointing at it names its state in the bar's
 *   tooltip (the glyph alone doesn't say it).
 * states: default (its state's glyph) · hover (the hover fill) · focus-visible (the base ring) · active (pressed)
 *   · disabled n/a · loading (the ring filling) · error (the danger icon) · success (the mark, then gone) ·
 *   inactive window (ink-3)
 * motion: the success mark fades in and out over --dur-short on --ease-out (opacity only); reduced motion: a 150 ms
 *   fade. The ring's arc follows the bytes without animating.
 * contrast: ink-2 arc on canvas ≥ 7:1 (it carries the state; the rule track is decoration); danger-strong ≥ 4.5:1
 * pre-emit critique: P5 H4 E4 S5 R5 V5 · slop subset: pass (1-7, 10-19, 22-27, 37-38a, 40-41 via axe, 46-49)
 */
import { useLingui } from '@lingui/react/macro';
import type { Downloads } from '@taalcut/core';
import {
  AnimatePresence,
  Button,
  DUR,
  EASE_OUT,
  motion,
  REDUCED_FADE,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useHostPlatform,
  useReducedMotion,
} from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { ArrowDown, CircleAlert, CircleCheck, Pause } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ToggleEvent } from 'react';
import { useOnline } from '../shared/use-online';
import { fractionOf, formatProgress } from './download-format';
import { DownloadsControls } from './downloads-controls';
import { DownloadsProblems, JobList } from './downloads-parts';
import { useDownloads } from './downloads-store';
import { DownloadsSummary } from './downloads-summary';
import { useDownloadActions } from './use-download-actions';

const DONE_SHOWN_MS = 4000;
const RADIUS = 6.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A 16 px ring filled to `fraction`, with an optional glyph inside. */
function Ring({ fraction, paused }: { fraction: number; paused: boolean }) {
  return (
    <span className="relative inline-flex size-4 items-center justify-center">
      <svg aria-hidden viewBox="0 0 16 16" className="absolute inset-0 size-4 -rotate-90">
        <circle cx="8" cy="8" r={RADIUS} fill="none" strokeWidth="2" className="stroke-rule" />
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE * fraction} ${CIRCUMFERENCE}`}
          className="stroke-current"
        />
      </svg>
      {paused ? <Pause aria-hidden className="size-2 fill-current stroke-[3]" /> : null}
    </span>
  );
}

/** True for a while after the download finished in front of the person (not at a launch that finds it done). */
function useJustFinished(state: Downloads['state'] | undefined): boolean {
  const [shown, setShown] = useState(false);
  const last = useRef(state);
  useEffect(() => {
    const was = last.current;
    last.current = state;
    if (state !== 'ready' || (was !== 'downloading' && was !== 'paused')) return;
    setShown(true);
    const timer = setTimeout(() => setShown(false), DONE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [state]);
  return shown && state === 'ready';
}

function Glyph({ downloads }: { downloads: Downloads }) {
  const fraction = fractionOf(downloads.bytesDone, downloads.bytesTotal);
  switch (downloads.state) {
    case 'downloading':
      return <Ring fraction={fraction} paused={false} />;
    case 'paused':
      return <Ring fraction={fraction} paused />;
    case 'failed':
      return <CircleAlert aria-hidden className="text-danger-strong" />;
    case 'missing':
      return <ArrowDown aria-hidden />;
    case 'ready':
      return <CircleCheck aria-hidden className="text-success-strong" />;
  }
}

function Popover({
  id,
  downloads,
  open,
  onOpenChange,
}: {
  id: string;
  downloads: Downloads;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const title = mac ? t`Models for this Mac` : t`Models for this computer`;
  const byJob = mac ? t`What this Mac needs, by job` : t`What this computer needs, by job`;
  const online = useOnline();
  const { error, refresh } = useDownloads();
  const actions = useDownloadActions();
  const titleId = useId();
  return (
    <div
      id={id}
      popover="auto"
      // A dialog while open only: a page's Escape and player keys look for an open layer by role, and this one sits
      // in the bar on every page, closed (LIB1-PROG found it on the analysis queue's popover).
      role={open ? 'dialog' : undefined}
      aria-labelledby={open ? titleId : undefined}
      data-slot="downloads-popover"
      // The toggle event doesn't bubble: the popover itself says when it opens and closes.
      onToggle={(event: ToggleEvent<HTMLDivElement>) => onOpenChange(event.newState === 'open')}
      className={[
        'app-no-drag m-0 w-96 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border border-rule-subtle',
        'bg-popover p-4 text-popover-foreground shadow-md',
        'max-h-[calc(100vh-var(--spacing-toolbar)-24px)] inset-auto [position-anchor:--downloads]',
        'top-[calc(anchor(bottom)+8px)] right-[anchor(right)]',
      ].join(' ')}
    >
      {open ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="m-0 text-base font-semibold text-ink">
              {title}
            </h2>
            <DownloadsControls downloads={downloads} actions={actions} className="justify-end" />
          </div>
          <DownloadsSummary downloads={downloads} online={online} />
          <DownloadsProblems
            downloads={downloads}
            readError={error}
            actions={actions}
            onReadAgain={refresh}
          />
          {downloads.components.length > 0 ? (
            <JobList
              components={downloads.components}
              online={online}
              actions={actions}
              label={byJob}
              rowRetry={downloads.state !== 'failed'}
            />
          ) : null}
          <Link
            to="/settings/models/downloads"
            className="self-start text-sm font-medium text-ink underline underline-offset-4"
          >
            {t`Open Settings › Models`}
          </Link>
        </div>
      ) : (
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
      )}
    </div>
  );
}

/** The download of everything this Mac needs, at the window bar's right end (UX2-DOWNLOADER). */
export function DownloadsIndicator() {
  const { t, i18n } = useLingui();
  const reduced = useReducedMotion();
  const { downloads } = useDownloads();
  const finished = useJustFinished(downloads?.state);
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const shown = downloads !== null && (downloads.state !== 'ready' || finished || open);
  const fraction = downloads ? fractionOf(downloads.bytesDone, downloads.bytesTotal) : 0;
  const percent = formatProgress(i18n, fraction);
  const label = !downloads
    ? ''
    : {
        downloading: t`Downloading models, ${percent}`,
        paused: t`Model downloads paused at ${percent}`,
        failed: t`Some models didn’t download`,
        missing: t`Models not downloaded`,
        ready: t`Models downloaded`,
      }[downloads.state];
  const fade = { duration: reduced ? REDUCED_FADE : DUR.short, ease: EASE_OUT };
  return (
    <AnimatePresence initial={false}>
      {shown && downloads ? (
        <motion.span
          key="downloads"
          data-slot="downloads-indicator"
          data-state={downloads.state}
          className="flex items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={label}
                popoverTarget={popoverId}
                data-action="open-downloads"
                className="size-7 text-ink-2 [anchor-name:--downloads] window-inactive:text-ink-3"
              >
                <Glyph downloads={downloads} />
              </Button>
            </TooltipTrigger>
            {/* Its name, for a pointer: the glyph alone doesn't say it. Not while the popover is open. */}
            {open ? null : <TooltipContent>{label}</TooltipContent>}
          </Tooltip>
          <Popover id={popoverId} downloads={downloads} open={open} onOpenChange={setOpen} />
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
