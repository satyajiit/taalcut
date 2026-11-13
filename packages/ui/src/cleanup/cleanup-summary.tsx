// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cleanup summary · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * what a cleanup plan does in one sentence ("Remove 14 fillers, shorten 9 pauses, cut 2 retakes and add 3
 *   punch-ins: 0:52 → 0:41") over the cut it was planned on: the kit's mini timeline, the removed spans hatched in
 *   neutral ink (a mark on the data, not a colour with a meaning), the punch-ins as a bar along the top, and a
 *   two-item key
 * states: default · dimmed (re-planning: the numbers and the strip fade back, aria-busy) · no strip (the cut isn't
 *   loaded, or it moved on since the plan: the sentence alone) · disabled/hover/focus: n/a (it reads, it doesn't
 *   act) · pre-emit critique: P4 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { CleanupPlan, Timeline } from '@taalcut/core';
import { cn } from '#lib/cn';
import { MiniTimeline } from '../make/mini-timeline';
import { useTimecode } from '../make/timecode';
import { clipShot, videoClips } from '../make/timeline-math';
import { useShotFrames } from '../make/use-shot-frames';
import { cleanupMarks, type CleanupMarks } from './cleanup-math';
import { cleanupSentence } from './cleanup-words';

export interface CleanupSummaryProps {
  readonly plan: CleanupPlan;
  /** The cut the plan was made on; null or another revision: no strip. */
  readonly timeline: Timeline | null | undefined;
  /** Seconds of video before and after. */
  readonly before: number;
  readonly after: number;
  /** A new plan is on its way. */
  readonly dimmed?: boolean;
  readonly className?: string;
}

const MS = { num: 1000, den: 1 } as const;
/** Hatching in the theme's ink, so it reads on the strip's sunken bed in light and dark. */
const HATCH = 'bg-[repeating-linear-gradient(135deg,var(--color-ink-2)_0_1px,transparent_1px_5px)]';

function Marks({ marks }: { readonly marks: CleanupMarks }) {
  const pct = (frame: number) => `${(frame / Math.max(1, marks.total)) * 100}%`;
  return (
    // The mini timeline's strip sits 0.5 rem in and is 3 rem tall: the marks lie over it.
    <div aria-hidden data-slot="cleanup-marks" className="pointer-events-none absolute inset-x-2 top-2 h-12">
      {marks.removed.map((span) => (
        <span
          key={`cut-${span.start}`}
          data-slot="cleanup-removed"
          className={cn('absolute inset-y-0 rounded-[2px] bg-scrim/30', HATCH)}
          style={{ left: pct(span.start), width: pct(span.end - span.start) }}
        />
      ))}
      {marks.punches.map((span) => (
        <span
          key={`punch-${span.start}`}
          data-slot="cleanup-punch"
          className="absolute top-0 h-1 rounded-pill bg-ink"
          style={{ left: pct(span.start), width: pct(span.end - span.start) }}
        />
      ))}
    </div>
  );
}

export function CleanupSummary({
  plan,
  timeline,
  before,
  after,
  dimmed = false,
  className,
}: CleanupSummaryProps) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const onPlan =
    timeline && timeline.id === plan.timelineId && timeline.revision === plan.revision ? timeline : null;
  const clips = onPlan ? videoClips(onPlan) : [];
  const frames = useShotFrames(clips.map(clipShot));
  const sentence = cleanupSentence(
    i18n,
    plan.stats,
    time.clock(Math.round(before * 1000), MS),
    time.clock(Math.round(after * 1000), MS),
  );
  return (
    <div
      data-slot="cleanup-summary"
      aria-busy={dimmed || undefined}
      className={cn(
        'flex flex-col gap-2 transition-opacity duration-(--dur-short) ease-(--ease-out)',
        dimmed && 'opacity-50',
        className,
      )}
    >
      <p className="m-0 text-sm text-ink tabular-nums" data-slot="cleanup-sentence">
        {sentence}
      </p>
      {onPlan ? (
        <>
          <div className="relative">
            <MiniTimeline timeline={onPlan} frames={(clip) => frames(clipShot(clip))?.url} />
            <Marks marks={cleanupMarks(onPlan, plan)} />
          </div>
          <p aria-hidden className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn('inline-block size-3 rounded-[2px] border border-rule bg-scrim/30', HATCH)}
              />
              {t`Cut`}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1 w-3 rounded-pill bg-ink" />
              {t`Punched in`}
            </span>
          </p>
        </>
      ) : null}
    </div>
  );
}
