// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: design options card (DSG2) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the motion graphic card for a graphic that came with designs to choose between: a step
 *   panel (unboxed) titled with the name of the design in the video (the model's words, shown as content), one
 *   line that says what to do, then the picker: each design as a still over the person's own video with its name
 *   and idea, the one in the video marked. One click swaps another in (one ⌘Z). Under it, when it plays, Try again
 *   (three new designs: the run's follow-up, the graphic as a chip), Change… (the composer) and Edit in video.
 *   A graphic without options keeps the designed graphic card (MotionGraphicCard picks).
 * layout: by the card's own width (a container query): rows in the editor's chat column, three columns in the
 *   chat page
 * states: loading (the card's snapshot until the live timeline is in) · default · choosing · switched (the
 *   changed line) · changed by you (teal chip) · gone (not on the timeline, or the video deleted: no picker) ·
 *   sent ("Asked for three new designs.") · errors under what failed · no actions (no command bus): a record
 * motion: none · pre-emit critique: P4 H4 E4 S4 R5 V4 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { CardOf, SelectionChip, Timeline } from '@taalcut/core';
import { MessageSquareText, RefreshCw } from 'lucide-react';
import { useId } from 'react';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { clipShot } from '../make/timeline-math';
import { useTimecode } from '../make/timecode';
import { useShotFrames } from '../make/use-shot-frames';
import { designOf } from '../media/design-reads';
import { useProposalChat } from '../media/graphic-proposal';
import { useMediaActions } from '../media/media-actions';
import { ChangedLine, MediaError } from '../media/media-lines';
import { clipAt, graphicOn } from '../media/timeline-reads';
import { useCommand } from '../media/use-command';
import { UserContent } from './card-frame';
import { useTimelineRead } from './card-data';
import { DesignGraphicCard } from './design-graphic-card';
import { DesignOptionPicker } from './design-option-picker';
import { legacyValue, type LiveReadState } from './live-read';
import { LiveReadLine } from './live-read-line';
import { StepHeader } from './step-header';
import { UnmatchedRow } from './unmatched-row';
import { canvasAspect, CHOOSE_OPTION, useDesignOptions } from './use-design-options';

type Card = CardOf<'motionGraphic'>;

/**
 * The motion graphic card: the options card when the graphic has designs to choose between (two or more, as the
 * timeline says now, else as the card said), the designed graphic card otherwise. A set starts with the one design
 * in the video and grows as the others are placed, so one design is nothing to choose yet.
 */
export function MotionGraphicCard({ card }: { card: Card }) {
  const watched = useTimelineRead(card.timelineId);
  const live = legacyValue(watched.read);
  const item = live ? graphicOn(live, card.itemId) : null;
  const offered = item ? (item.options?.designs.length ?? 0) > 1 : card.options !== undefined;
  return offered ? <DesignOptionsCard card={card} watched={watched} /> : <DesignGraphicCard card={card} />;
}

/** A graphic and the designs it came with: pick one, ask for three new ones, or change it with words. */
export function DesignOptionsCard({ card, watched }: { card: Card; watched: LiveReadState<Timeline> }) {
  const { t } = useLingui();
  const time = useTimecode();
  const labelId = useId();
  const { editTurn } = useMediaActions();
  const live = legacyValue(watched.read);
  const command = useCommand();
  const item = live ? graphicOn(live, card.itemId) : null;
  const design = designOf(live, item);
  const deleted = watched.read.status === 'gone';
  const missing = live !== null && live !== undefined && item === null;
  const start = item?.start ?? card.start;
  const duration = item?.duration ?? card.duration;
  const startWords = time.clock(start.value, start.rate, { fraction: true });
  const lengthWords = time.length(duration.value, duration.rate);
  const off = !command.can || deleted || missing;
  const name = design?.name ?? card.composition.name;
  const unmatched = item?.anchor.kind === 'time' && item.origin === 'user' ? [] : card.unmatched;
  // What a tile shows without a still of its own: the frame of the shot the graphic sits on.
  const under = live ? clipAt(live, start.value) : null;
  const shots = useShotFrames(under ? [clipShot(under)] : []);
  const options = useDesignOptions({
    projectId: card.projectId,
    timeline: live,
    item,
    snapshot: card.options,
    snapshotInUse: card.composition.id,
    fallback: under ? (shots(clipShot(under))?.url ?? null) : null,
  });
  const chip: SelectionChip = {
    kind: 'item',
    timelineId: card.timelineId,
    itemId: card.itemId,
    itemKind: 'graphic',
  };
  const { tryAgain, onChange } = useProposalChat(card.runId, chip);
  const busy = command.busy?.startsWith('choose:') ? command.busy.slice('choose:'.length) : null;
  const choose = (compositionId: string) =>
    void command.run(`choose:${compositionId}`, CHOOSE_OPTION, {
      projectId: card.projectId,
      timelineId: card.timelineId,
      itemId: card.itemId,
      compositionId,
    });
  const title = (
    <UserContent translate="no" className="[overflow-wrap:anywhere]">
      {name}
    </UserContent>
  );

  return (
    <article
      data-slot="smart-card"
      data-card-type="motionGraphic"
      data-design=""
      data-options=""
      aria-labelledby={labelId}
      className="@container flex max-w-[42rem] flex-col gap-3"
    >
      {/* Its name for a screen reader: the design's name as the model wrote it, the words before it translated. */}
      <span id={labelId} className="sr-only">
        <Trans>
          Motion graphic: <UserContent translate="no">{name}</UserContent>
        </Trans>
      </span>
      <StepHeader
        title={title}
        aside={item?.origin === 'user' ? <Chip tone="you">{t`You changed this`}</Chip> : null}
      />
      {deleted ? (
        <p className="m-0 text-sm text-ink-2">{t`This video was deleted.`}</p>
      ) : missing ? (
        <p className="m-0 text-sm text-ink-2">{t`The graphic isn’t on the timeline now.`}</p>
      ) : (
        <>
          {off ? null : (
            <p className="m-0 text-sm text-ink-2">
              {t`Pick the design you like. The marked one is in your video now.`}
            </p>
          )}
          <DesignOptionPicker
            options={options}
            aspect={canvasAspect(live)}
            disabled={off}
            busy={busy}
            onChoose={choose}
          />
          {command.error ? <MediaError error={command.error.error} /> : null}
          {command.done?.startsWith('choose:') ? (
            <ChangedLine projectId={card.projectId}>{t`Switched to this design.`}</ChangedLine>
          ) : null}
          {unmatched.length > 0 ? <UnmatchedRow phrases={unmatched} /> : null}
          <p className="m-0 text-sm text-ink-2 tabular-nums">
            {t`Starts at ${startWords} · lasts ${lengthWords}`}
          </p>
          {(off || (!tryAgain && !onChange)) && !editTurn ? null : (
            <div className="flex flex-wrap items-center gap-2">
              {tryAgain && !off ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  loading={tryAgain.busy}
                  onClick={tryAgain.run}
                >
                  <RefreshCw aria-hidden />
                  {t`Try again`}
                </Button>
              ) : null}
              {onChange && !off ? (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onChange}>
                  <MessageSquareText aria-hidden />
                  {t`Change…`}
                </Button>
              ) : null}
              {editTurn ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    editTurn.open(card.projectId, chip, (start.value * start.rate.den) / start.rate.num)
                  }
                >
                  {t`Edit in video`}
                </Button>
              ) : null}
            </div>
          )}
          {tryAgain?.sent ? (
            <p role="status" className="m-0 text-sm text-ink-2">{t`Asked for three new designs.`}</p>
          ) : null}
          {tryAgain?.error ? <MediaError error={tryAgain.error} /> : null}
        </>
      )}
      <LiveReadLine read={watched.read} onRetry={watched.retry} gone={false} />
    </article>
  );
}
