// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: variant tile (P3-V3) · genre: atmospheric studio app (the viewer + chrome modern-minimal)
 * system: DESIGN.md v0.3 · one video of a compare view: its 9:16 preview on the viewer grey, "Original" or
 *   "Variant 2" with the violet AI mark on what the AI made, its length, what differs in words, the teal "You
 *   changed this" when you edited it after the card, its newest export (neutral), then Open and Export
 * states: making (bones where the preview goes) · loading (the viewer grey) · ready (poster or preview) · playing
 *   (the shared clock drives the player) · rendering (the render line) · changed by you · disabled (deleted: "This
 *   video was deleted.", buttons off) · Open and Export are the kit's Button (default, hover, focus-visible, active,
 *   disabled, loading; their errors are the view's line) · reduced motion: the poster only
 * pre-emit critique: P4 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { ProjectId, TimelineId, VariantDifference } from '@taalcut/core';
import { ArrowUpRight } from 'lucide-react';
import { useEffect } from 'react';
import { AiMark } from '#components/ai-mark';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { VERB_ICONS } from '../icons/concepts';
import { UserContent } from '../cards/card-frame';
import { useCardData, useLiveTimeline } from '../cards/card-data';
import { ShotThumb } from '../make/shot-thumb';
import { framesToMs, useTimecode } from '../make/timecode';
import { clipShot, placeVideo, videoClips } from '../make/timeline-math';
import { useShotFrames } from '../make/use-shot-frames';
import { RenderLine } from './render-line';
import { useLatestRender } from './use-latest-render';
import { useVariantPlayer } from './variant-player';
import { differenceWords } from './variant-words';

/** One video of the compare view, as the card (or the editor) knows it. */
export interface CompareVariant {
  readonly timelineId: TimelineId;
  /** The revision the card names: a newer one is your edit (the agent re-sends the card when it changes one). */
  readonly revision: number;
  /** "Original", "Variant 1"…, already translated. */
  readonly label: string;
  /** Optional custom video name, if given by the user or agent. */
  readonly title?: string | null | undefined;
  /** What differs from the original; null for the original. */
  readonly difference: VariantDifference | null;
}

export interface VariantTileProps {
  readonly projectId: ProjectId;
  /** Null: a variant still being made (bones). */
  readonly variant: CompareVariant | null;
  readonly playing: boolean;
  readonly epoch: number;
  /** Reduced motion: posters only, nothing plays. */
  readonly still: boolean;
  /** The video's length in milliseconds once known (the clock's Play all reads it); null when gone. */
  readonly onLength?: (timelineId: TimelineId, ms: number | null) => void;
  readonly onOpen?: (() => void) | undefined;
  readonly onRender?: (() => void) | undefined;
  readonly rendering?: boolean;
  /** Buttons off while the whole view waits (Export all in flight, the run still making). */
  readonly disabled?: boolean;
}

export function VariantTile(props: VariantTileProps) {
  const { t } = useLingui();
  if (!props.variant)
    return (
      <li
        data-slot="variant-tile"
        data-state="making"
        aria-busy="true"
        className="flex min-w-0 flex-col gap-2"
      >
        <span aria-hidden className="tc-bone block aspect-[9/16] w-full rounded-lg bg-hover" />
        <span aria-hidden className="tc-bone block h-3 w-2/3 rounded-sm bg-hover" />
        <span className="text-xs text-ink-2">{t`Making…`}</span>
      </li>
    );
  return <LiveTile {...props} variant={props.variant} />;
}

function LiveTile({
  projectId,
  variant,
  playing,
  epoch,
  still,
  onLength,
  onOpen,
  onRender,
  rendering = false,
  disabled = false,
}: VariantTileProps & { variant: CompareVariant }) {
  const { t, i18n } = useLingui();
  const data = useCardData();
  const player = useVariantPlayer();
  const time = useTimecode();
  const live = useLiveTimeline(variant.timelineId);
  const latest = useLatestRender(variant.timelineId);
  const clips = live ? videoClips(live) : [];
  const first = clips[0];
  const frames = useShotFrames(first ? [clipShot(first)] : []);
  const gone = live === null && data.watchTimeline !== undefined;
  const total = live ? placeVideo(live).total : null;
  const ms = live && total !== null ? framesToMs(total, live.canvas.rate) : null;
  const changed = live ? live.revision > variant.revision : false;
  const words = variant.difference ? differenceWords(i18n, variant.difference) : null;

  useEffect(() => {
    onLength?.(variant.timelineId, gone ? null : ms);
  }, [onLength, variant.timelineId, ms, gone]);

  const name = variant.label;
  const label = t`Preview of ${name}`;
  const preview = gone ? (
    <span className="tc-viewer block aspect-[9/16] w-full opacity-50" />
  ) : !live ? (
    <span className="tc-viewer block aspect-[9/16] w-full" />
  ) : !still && player ? (
    player({
      projectId,
      timelineId: variant.timelineId,
      revision: live.revision,
      label,
      playing,
      epoch,
      className: 'w-full',
    })
  ) : !still && data.renderPreview ? (
    data.renderPreview({ projectId, timelineId: variant.timelineId, revision: live.revision, label })
  ) : (
    <ShotThumb url={first ? frames(clipShot(first))?.url : null} alt={label} className="block w-full" />
  );

  return (
    <li
      data-slot="variant-tile"
      data-timeline={variant.timelineId}
      data-state={gone ? 'deleted' : 'ready'}
      data-playing={playing && !gone && !still ? 'true' : 'false'}
      data-epoch={epoch}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="overflow-hidden rounded-lg">{preview}</div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{variant.label}</span>
          {variant.title ? (
            <UserContent translate="no" className="truncate text-xs text-ink-2">
              {variant.title}
            </UserContent>
          ) : null}
          {variant.difference ? <AiMark label={t`Made by the AI`} /> : null}
          {live && total !== null ? (
            <span className="ms-auto shrink-0 text-xs text-ink-2 tabular-nums">
              {time.length(total, live.canvas.rate)}
            </span>
          ) : null}
        </p>
        {gone ? (
          <p className="m-0 text-xs text-ink-2">{t`This video was deleted.`}</p>
        ) : words ? (
          <>
            <p className="m-0 text-xs text-ink-2">
              {words.changes.length > 0 ? words.changes.join(' · ') : t`The same hook, music and captions`}
            </p>
            {words.shots ? <p className="m-0 text-xs text-ink-3 tabular-nums">{words.shots}</p> : null}
          </>
        ) : (
          <p className="m-0 text-xs text-ink-2">{t`The video these were made from`}</p>
        )}
        {changed && !gone ? <Chip tone="you">{t`You changed this`}</Chip> : null}
        {latest && !gone ? <RenderLine render={latest} label={variant.label} /> : null}
      </div>
      <div className={cn('mt-auto flex flex-wrap items-center gap-1', !onOpen && !onRender && 'hidden')}>
        {onOpen ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={gone}
            aria-label={t`Open ${name} in the editor`}
            onClick={onOpen}
          >
            {t`Open`}
            <ArrowUpRight aria-hidden />
          </Button>
        ) : null}
        {onRender ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={gone || disabled}
            loading={rendering}
            aria-label={t`Export ${name}`}
            icon={VERB_ICONS.export}
            onClick={onRender}
          >
            {t`Export`}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
