// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: timeline card (P2-M7) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a step panel: the cut in small (the app's preview over proxies beside the mini timeline:
 *   neutral clips with their frames, AI picks with a violet edge, your swaps teal, rose beats, the marigold
 *   playhead), its length and shape, Open editor; a clip opens its line (other shots, a beat shorter or longer, Add
 *   to chat)
 * states: loading (the cut's bones) · default (live: an edit or ⌘Z shows without a new card) · clip open (the clip's
 *   line under the cut) · changed since (teal "You changed this" from the step) · disabled (gone: "This was
 *   deleted.", no actions) · error/success: the clip line's
 *   · watch lost (UX round 1: the cut as last seen, with the cause and Try again; never "deleted")
 * motion: none of its own (the preview plays; the playhead follows it)
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { CardOf, TimelineItemId } from '@taalcut/core';
import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '#components/button';
import { ClipDetail } from '../make/clip-detail';
import { MiniTimeline } from '../make/mini-timeline';
import { ShotThumb } from '../make/shot-thumb';
import { StepHeader } from './step-header';
import { clipShot, videoClips } from '../make/timeline-math';
import { useTimecode } from '../make/timecode';
import { useShotFrames } from '../make/use-shot-frames';
import { useCardActions } from './card-actions';
import { useCardData, useTimelineRead } from './card-data';
import { liveValue } from './live-read';
import { LiveReadLine } from './live-read-line';

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function TimelineCard({ card }: { card: CardOf<'timeline'> }) {
  const { t, i18n } = useLingui();
  const actions = useCardActions();
  const data = useCardData();
  const time = useTimecode();
  const watched = useTimelineRead(card.timelineId);
  const live = liveValue(watched.read);
  const loading = watched.read.status === 'loading' && live === null;
  const [open, setOpen] = useState<TimelineItemId | null>(null);
  const [playhead, setPlayhead] = useState<number | undefined>(undefined);
  const clips = live ? videoClips(live) : [];
  const frames = useShotFrames(clips.map(clipShot));
  const gone = watched.read.status === 'gone';
  const title = t`Your cut`;

  const length = live
    ? time.length(
        clips.reduce((sum, clip) => sum + clip.duration.value, 0),
        live.canvas.rate,
      )
    : time.length(card.duration.value, card.duration.rate);
  const count = live ? clips.length : card.clipCount;
  const divisor = live ? gcd(live.canvas.width, live.canvas.height) : 1;
  const shape = live
    ? `${i18n.number(live.canvas.width / divisor)}:${i18n.number(live.canvas.height / divisor)}`
    : null;
  const first = clips[0];

  return (
    <article
      data-slot="smart-card"
      data-card-type="timeline"
      aria-label={title}
      className="flex max-w-[42rem] flex-col gap-3"
    >
      <StepHeader
        title={title}
        step={card.step}
        aside={
          actions.navigate && !gone ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                actions.navigate?.({ to: 'timeline', projectId: card.projectId, timelineId: card.timelineId })
              }
            >
              {t`Open editor`}
              <ArrowUpRight aria-hidden />
            </Button>
          ) : null
        }
      />
      {gone ? null : (
        <div className="flex items-start gap-4">
          <div className={live && live.canvas.width > live.canvas.height ? 'w-44 shrink-0' : 'w-24 shrink-0'}>
            {live && data.renderPreview ? (
              data.renderPreview({
                projectId: card.projectId,
                timelineId: card.timelineId,
                revision: live.revision,
                label: t`Preview of your cut`,
                onFrame: setPlayhead,
              })
            ) : (
              <ShotThumb url={first ? frames(clipShot(first))?.url : null} size="lg" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="m-0 text-sm text-ink-2 tabular-nums">
              {shape
                ? t`${length} · ${shape} · ${plural(count, { one: '# clip', other: '# clips' })}`
                : t`${length} · ${plural(count, { one: '# clip', other: '# clips' })}`}
            </p>
            {live ? (
              <>
                <MiniTimeline
                  timeline={live}
                  playheadFrame={playhead}
                  selectedClipId={open}
                  onSelectClip={(clipId) => setOpen((was) => (was === null ? null : clipId))}
                  onActivateClip={(clipId) => setOpen((was) => (was === clipId ? null : clipId))}
                  frames={(clip) => frames(clipShot(clip))?.url}
                />
                {open ? (
                  <ClipDetail
                    projectId={card.projectId}
                    timeline={live}
                    clipId={open}
                    onClose={() => setOpen(null)}
                  />
                ) : (
                  <p className="m-0 text-xs text-ink-3">{t`Choose a clip to swap it, trim it or ask about it.`}</p>
                )}
              </>
            ) : loading ? (
              <div
                aria-busy="true"
                data-slot="loading"
                className="flex flex-col gap-1.5 rounded-xl bg-panel p-2"
              >
                <span className="sr-only">{t`Loading your cut`}</span>
                <span aria-hidden className="tc-bone block h-12 rounded-clip bg-hover" />
                <span aria-hidden className="tc-bone block h-2.5 rounded-sm bg-hover" />
              </div>
            ) : null}
          </div>
        </div>
      )}
      <LiveReadLine read={watched.read} onRetry={watched.retry} gone={t`This video was deleted.`} />
    </article>
  );
}
